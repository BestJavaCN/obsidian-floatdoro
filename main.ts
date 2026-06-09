import { App, Plugin, PluginSettingTab, Setting, Notice, addIcon, setIcon } from 'obsidian';
import { PomoTimer, TimerState, PomodoroSettings, DEFAULT_SETTINGS, Language } from './PomoTimer';
import { t } from './i18n';

export default class PomodoroPlugin extends Plugin {
    settings: PomodoroSettings;
    private timer: PomoTimer;
    private currentMode: TimerState = TimerState.Work;
    private completedPomodoros: number = 0;
    private nextMode: TimerState = TimerState.ShortBreak;
    private isSessionComplete: boolean = false;

    // UI Elements
    private containerEl: HTMLElement | null = null;
    private controlPanelEl: HTMLDivElement | null = null;
    private pieButtonEl: HTMLButtonElement | null = null;
    private pieCircleEl: SVGCircleElement | null = null;
    private panelTimeEl: HTMLElement | null = null;
    private panelModeEl: HTMLDivElement | null = null;
    private panelHeaderEl: HTMLDivElement | null = null;
    private panelWrapperEl: HTMLElement | null = null;
    private playButtonEl: HTMLButtonElement | null = null;
    private isVisible = true;
    private isPanelExpanded = false;
    private isDisabled = false;
    private isFlipped = false;

    // Flip related
    private flipContainerEl: HTMLDivElement | null = null;
    private backPanelEl: HTMLDivElement | null = null;

    // Drag related variables
    private isDragging = false;
    private hasDragged = false;
    private dragPending = false;
    private dragOffset = { x: 0, y: 0 };
    private dragStartPos = { x: 0, y: 0 };
    private lastPosition = { x: 0, y: 0 };

    async onload() {
        await this.loadSettings();

        // Register the custom timer icon (SVG structure)
        addIcon('minidoro-timer', `
            <svg viewBox="0 0 20 20" class="minidoro-pie-chart">
                <circle class="minidoro-progress-track" cx="10" cy="10" r="8" fill="transparent" stroke-width="4"></circle>
                <circle class="minidoro-progress-circle" cx="10" cy="10" r="8" fill="transparent" stroke-width="4"></circle>
            </svg>
        `);

        this.timer = new PomoTimer(
            this, // Pass plugin instance for registerInterval
            this.settings,
            (remaining, total) => this.updateUI(remaining, total),
            (state) => this.onTimerCompletion(state),
            () => this.onTimerComplete(),
            (elapsedMinutes) => this.handleOvertimeReminder(elapsedMinutes),
            () => this.handleOvertimeLimitReached()
        );

        this.addSettingTab(new PomodoroSettingTab(this.app, this));
        
        // Register commands for keyboard shortcuts
        this.addCommand({
            id: 'start-pause-timer',
            name: 'Start/pause timer',
            callback: () => {
                this.handlePauseResumeClick();
            }
        });

        this.addCommand({
            id: 'reset-timer',
            name: 'Reset timer',
            callback: () => {
                this.handleResetClick();
            }
        });

        this.addCommand({
            id: 'switch-mode',
            name: 'Switch mode',
            callback: () => {
                this.handleCycleModeClick();
            }
        });

        this.addCommand({
            id: 'toggle-visibility',
            name: '启用/禁用番茄钟',
            callback: () => {
                this.toggleVisibility();
            }
        });

        // Request notification permission on startup
        if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission().catch(err => console.error("Minidoro: Error requesting notification permission", err));
        }

        // Create floating panel after layout is ready
        this.app.workspace.onLayoutReady(() => {
            this.createFloatingPanel();
            this.registerEvent(
                this.app.workspace.on('active-leaf-change', () => {
                    this.createFloatingPanel();
                })
            );
        });
    }

    onunload() {
        this.destroyFloatingPanel();
    }

    async loadSettings() { 
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); 
    }
    
    async saveSettings() { 
        await this.saveData(this.settings); 
        this.timer.updateSettings(this.settings); 
        this.updateUI(0, 0); 
        this.updatePanelSize();
    }
    
    private updatePanelSize() {
        if (!this.containerEl) return;
        this.containerEl.classList.remove('small', 'medium', 'large');
        this.containerEl.classList.add(this.settings.panelSize);

        if (this.panelWrapperEl) {
            this.panelWrapperEl.classList.remove('small', 'medium', 'large');
            this.panelWrapperEl.classList.add(this.settings.panelSize);
        }
    }

    private createFloatingPanel() {
        if (this.isDisabled) {
            return;
        }

        
        // Remove existing button if any (for switching between notes)
        if (this.pieButtonEl) {
            this.pieButtonEl.remove();
            this.pieButtonEl = null;
            this.pieCircleEl = null;
        }

        // Find the active pane's title bar
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf) {
            return;
        }

        // Try different selectors to find the view header
        let titleEl: Element | null = activeLeaf.view?.containerEl?.querySelector('.view-header') ?? null;
        
        // Alternative: try to find in the leaf's container
        if (!titleEl) {
            titleEl = activeLeaf.view?.containerEl?.closest('.workspace-leaf')?.querySelector('.view-header') ?? null;
        }
        
        // Another alternative: look for the active leaf's header
        if (!titleEl) {
            const activeLeafEl = document.querySelector('.workspace-leaf.mod-active');
            if (activeLeafEl) {
                titleEl = activeLeafEl.querySelector('.view-header');
            }
        }
        
        if (!titleEl) {
            return;
        }

        // Find the view actions container (right side button group)
        const viewActions = titleEl.querySelector('.view-actions');
        
        // Create pie button with Obsidian's native view-action classes
        this.pieButtonEl = document.createElement('button');
        this.pieButtonEl.className = `minidoro-pie-button view-action clickable-icon ${this.settings.panelSize}`;
        
        // Insert before the first child of view-actions, or append to titleEl if view-actions not found
        if (viewActions && viewActions.firstChild) {
            viewActions.insertBefore(this.pieButtonEl, viewActions.firstChild);
        } else {
            titleEl.appendChild(this.pieButtonEl);
        }
        
        // The container is now the pie button itself
        this.containerEl = this.pieButtonEl;
        this.pieButtonEl.setAttribute('aria-label', 'Minidoro timer');
        this.pieButtonEl.onclick = (event) => {
            event.stopPropagation();
            this.togglePanel();
        };
        
        // SVG Creation using setIcon
        setIcon(this.pieButtonEl, 'minidoro-timer');

        // Retrieve the reference to the dynamic circle element
        this.pieCircleEl = this.pieButtonEl.querySelector('.minidoro-progress-circle');

        // Create control panel only if it doesn't exist yet
        if (!this.controlPanelEl) {
            this.createControlPanel();
        }

        // Update only the pie button (panel doesn't need updating as it's already showing correct state)
        const remainingTime = this.timer.getRemainingTime();
        const totalTime = this.timer.getTotalTime();
        this.updatePieButton(remainingTime, totalTime);
    }
    
    private updatePieButton(remainingTime: number, totalTime: number) {
        if (!this.pieCircleEl) return;
        
        const timerState = this.timer.getState();
        const isOvertime = this.timer.isOvertime();
        
        this.pieCircleEl.removeClass('minidoro-work-mode', 'minidoro-short-break-mode', 'minidoro-long-break-mode', 'minidoro-overtime-mode');
        this.pieCircleEl.removeClass('minidoro-progress-complete', 'minidoro-progress-idle');

        if (isOvertime) {
            this.pieCircleEl.addClass('minidoro-overtime-mode');
        } else {
            const modeClass = this.getModeClass();
            this.pieCircleEl.addClass(modeClass);
        }

        if (this.panelHeaderEl) {
            if (this.currentMode === TimerState.Work && timerState === TimerState.Work) {
                this.panelHeaderEl.addClass('minidoro-spinning');
            } else {
                this.panelHeaderEl.removeClass('minidoro-spinning');
            }
            if (isOvertime) {
                this.panelHeaderEl.addClass('minidoro-overtime-pulse');
            } else {
                this.panelHeaderEl.removeClass('minidoro-overtime-pulse');
            }
            if (this.timer.isOvertimeLimitReached()) {
                this.panelHeaderEl.addClass('minidoro-overtime-limit');
            } else {
                this.panelHeaderEl.removeClass('minidoro-overtime-limit');
            }
        }

        const radius = this.pieCircleEl.r.baseVal.value;
        const circumference = 2 * Math.PI * radius;

        let progress: number;
        if (isOvertime) {
            progress = 1;
        } else if (timerState === TimerState.Idle) {
            progress = 1; 
            this.pieCircleEl.addClass('minidoro-progress-idle');
        } else {
            progress = totalTime > 0 ? remainingTime / totalTime : 0;
            if (progress <= 0) {
                this.pieCircleEl.addClass('minidoro-progress-complete');
            }
        }

        this.pieCircleEl.style.setProperty('--progress', progress.toString());
        this.pieCircleEl.style.setProperty('--circumference', circumference.toString());

        if (this.isSessionComplete) {
            this.containerEl?.addClass('session-complete');
        } else {
            this.containerEl?.removeClass('session-complete');
        }
    }

    private createControlPanel() {
        if (!this.containerEl) {
            return;
        }
        
        // Create wrapper directly in body (not as child of button)
        const wrapperEl = document.body.createEl('div', { cls: `minidoro-control-panel-wrapper ${this.settings.panelSize}` });
        this.panelWrapperEl = wrapperEl;
        
        // Create flip container
        this.flipContainerEl = wrapperEl.createEl('div', { cls: 'minidoro-flip-container' });
        
        // Create front face
        const frontFace = this.flipContainerEl.createEl('div', { cls: 'minidoro-flip-front' });
        // Create actual control panel on front face
        this.controlPanelEl = frontFace.createEl('div', { cls: 'minidoro-control-panel' });
        
        // Create back face
        const backFace = this.flipContainerEl.createEl('div', { cls: 'minidoro-flip-back' });
        this.backPanelEl = backFace.createEl('div', { cls: 'minidoro-control-panel minidoro-back-panel' });
        
        // --- Build front face (control panel) ---
        
        // Create header section (purple area)
        const headerEl = this.controlPanelEl.createEl('div', { 
            cls: 'minidoro-panel-header',
            attr: { 
                'title': 'Click to switch mode (only when timer is reset)',
                'role': 'button',
                'tabindex': '0'
            } 
        });
        this.panelHeaderEl = headerEl;
        
        // Time display
        this.panelTimeEl = headerEl.createEl('div', { 
            cls: 'minidoro-panel-time'
        });
        
        // Mode display
        this.panelModeEl = headerEl.createEl('div', { 
            cls: 'minidoro-panel-mode'
        });
        
        // Set initial values for time and mode
        this.panelTimeEl.setText(this.getIdleTimeText());
        this.panelModeEl.setText(this.getModeText());
        this.panelModeEl.addClass(this.getModeClass());
        this.panelModeEl.addClass('mode-enabled');
        if (this.panelHeaderEl) {
            this.panelHeaderEl.addClass(this.getModeClass());
        }
        
        // Click header to switch mode
        headerEl.onclick = () => {
            if (this.hasDragged) {
                this.hasDragged = false;
                return;
            }
            this.handleCycleModeClick();
        };
        
        // Create button bar
        const buttonBar = this.controlPanelEl.createEl('div', { cls: 'minidoro-button-bar' });
        
        // Play button
        this.playButtonEl = buttonBar.createEl('button', { 
            cls: 'minidoro-btn minidoro-btn-play',
            attr: { 'title': 'Start timer' }
        });
        setIcon(this.playButtonEl, 'play');
        this.playButtonEl.onclick = () => this.handlePauseResumeClick();
        
        // Reset button
        const resetBtn = buttonBar.createEl('button', { 
            cls: 'minidoro-btn minidoro-btn-reset',
            attr: { 'title': 'Reset timer' }
        });
        setIcon(resetBtn, 'rotate-ccw');
        resetBtn.onclick = () => this.handleResetClick();
        
        // Complete button
		const completeBtn = buttonBar.createEl('button', { 
			cls: 'minidoro-btn minidoro-btn-complete',
			attr: { 'title': 'Complete session' }
		});
		setIcon(completeBtn, 'check');
		completeBtn.onclick = () => this.handleCompleteClick();

        // --- Build back face (lock button) ---
        
        const lockButton = this.backPanelEl.createEl('button', {
            cls: 'minidoro-lock-button',
            attr: { 'title': 'Lock vault' }
        });
        setIcon(lockButton, 'lock');
        lockButton.onclick = (event) => {
            event.stopPropagation();
            this.lockVault();
        };

        // Add drag event listeners to wrapper (works on both front and back faces)
        wrapperEl.addEventListener('mousedown', this.onDragStart);
        document.addEventListener('mousemove', this.onDragMove);
        document.addEventListener('mouseup', this.onDragEnd);
        wrapperEl.addEventListener('touchstart', this.onTouchStart);
        document.addEventListener('touchmove', this.onTouchMove, { passive: false });
        document.addEventListener('touchend', this.onTouchEnd);

        // Right-click context menu on the wrapper to flip the panel
        wrapperEl.addEventListener('contextmenu', this.onContextMenu);
    }

    private lockVault() {
        (this.app as any).commands.executeCommandById('vault-locker:lock-vault');
    }

    private toggleVisibility() {
        if (!this.containerEl || !this.isVisible) {
            this.isDisabled = false;
            this.createFloatingPanel();
            this.isVisible = true;
        } else {
            this.destroyFloatingPanel();
        }
    }

    private destroyFloatingPanel() {
        this.isDisabled = true;
        this.timer.stop();
        this.isSessionComplete = false;

        if (this.controlPanelEl) {
            const rect = this.controlPanelEl.getBoundingClientRect();
            this.settings.panelX = rect.left;
            this.settings.panelY = rect.top;
            void this.saveData(this.settings);
        }

        const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper');
        if (panelWrapper) {
            panelWrapper.remove();
        }

        if (this.containerEl) {
            this.containerEl.remove();
        }

        document.removeEventListener('mousemove', this.onDragMove);
        document.removeEventListener('mouseup', this.onDragEnd);
        document.removeEventListener('touchmove', this.onTouchMove);
        document.removeEventListener('touchend', this.onTouchEnd);

        this.containerEl = null;
        this.pieButtonEl = null;
        this.pieCircleEl = null;
        this.controlPanelEl = null;
        this.panelTimeEl = null;
        this.panelModeEl = null;
        this.panelHeaderEl = null;
        this.panelWrapperEl = null;
        this.playButtonEl = null;
        this.flipContainerEl = null;
        this.backPanelEl = null;
        this.isVisible = false;
        this.isPanelExpanded = false;
        this.isFlipped = false;
    }

    private togglePanel() {
        // Toggle panel expand/collapse
        if (!this.pieButtonEl || !this.controlPanelEl) return;
        
        const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
        
        if (panelWrapper) {
            if (this.isPanelExpanded) {
                // Collapse panel
                this.pieButtonEl.classList.remove('expanded');
                panelWrapper.classList.remove('expanded');
                panelWrapper.classList.remove('minidoro-flipped');
                this.isPanelExpanded = false;
                this.isFlipped = false;
            } else {
                // Expand panel - calculate position below button
                this.pieButtonEl.classList.add('expanded');
                panelWrapper.classList.add('expanded');
                
                // Calculate position based on pie button
                const buttonRect = this.pieButtonEl.getBoundingClientRect();
                const panelWidth = panelWrapper.offsetWidth;
                
                // Position panel centered below button
                const panelLeft = buttonRect.left + buttonRect.width / 2 - panelWidth / 2;
                const panelTop = buttonRect.bottom + 8; // 8px gap
                
                // Set panel position
                panelWrapper.style.position = 'fixed';
                panelWrapper.style.left = `${panelLeft}px`;
                panelWrapper.style.top = `${panelTop}px`;
                panelWrapper.style.right = 'auto';
                
                this.isPanelExpanded = true;
            }
        }
    }

    private onDragStart = (event: MouseEvent) => {
        // Only left-click (button === 0) should initiate dragging
        if (event.button !== 0) return;
        
        const target = event.target as HTMLElement;
        if (target.closest('.minidoro-btn, .minidoro-lock-button')) {
            return;
        }
        
        const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
        if (!panelWrapper) return;
        
        this.hasDragged = false;
        this.dragPending = true;
        this.dragStartPos = { x: event.clientX, y: event.clientY };
        
        const rect = panelWrapper.getBoundingClientRect();
        this.dragOffset = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    };

    private onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        this.toggleFlip();
    };

    private toggleFlip() {
        if (!this.panelWrapperEl) return;
        this.isFlipped = !this.isFlipped;
        if (this.isFlipped) {
            this.panelWrapperEl.addClass('minidoro-flipped');
        } else {
            this.panelWrapperEl.removeClass('minidoro-flipped');
        }
    }

    private onDragMove = (event: MouseEvent) => {
        if (!this.isDragging) {
            if (!this.dragPending) return;
            const dx = Math.abs(event.clientX - this.dragStartPos.x);
            const dy = Math.abs(event.clientY - this.dragStartPos.y);
            const DRAG_THRESHOLD = 5;
            if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
                return;
            }
            this.isDragging = true;
            this.hasDragged = true;
            const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
            panelWrapper?.addClass('dragging');
        }
        
        const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
        if (!panelWrapper) return;

        const x = event.clientX - this.dragOffset.x;
        const y = event.clientY - this.dragOffset.y;

        const maxX = window.innerWidth - (panelWrapper.offsetWidth || 150);
        const maxY = window.innerHeight - (panelWrapper.offsetHeight || 100);
        
        this.lastPosition = {
            x: Math.max(0, Math.min(x, maxX)),
            y: Math.max(0, Math.min(y, maxY))
        };

        panelWrapper.style.right = 'auto';
        panelWrapper.style.left = `${this.lastPosition.x}px`;
        panelWrapper.style.top = `${this.lastPosition.y}px`;
        panelWrapper.style.position = 'fixed';
    };

    private onDragEnd = () => {
        this.dragPending = false;
        if (!this.isDragging) return;
        
        this.isDragging = false;
        const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
        panelWrapper?.removeClass('dragging');
        
        if (this.hasDragged) {
            this.settings.panelX = this.lastPosition.x;
            this.settings.panelY = this.lastPosition.y;
            void this.saveData(this.settings);
        }
    };

    private onTouchStart = (event: TouchEvent) => {
        const target = event.target as HTMLElement;
        if (target.closest('.minidoro-btn, .minidoro-lock-button')) {
            return;
        }
        
        const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
        if (!panelWrapper) return;
        
        this.hasDragged = false;
        this.dragPending = true;
        const touch = event.touches[0];
        this.dragStartPos = { x: touch.clientX, y: touch.clientY };
        
        const rect = panelWrapper.getBoundingClientRect();
        this.dragOffset = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
    };

    private onTouchMove = (event: TouchEvent) => {
        if (!this.isDragging) {
            if (!this.dragPending) return;
            const touch = event.touches[0];
            const dx = Math.abs(touch.clientX - this.dragStartPos.x);
            const dy = Math.abs(touch.clientY - this.dragStartPos.y);
            const DRAG_THRESHOLD = 5;
            if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
                return;
            }
            this.isDragging = true;
            this.hasDragged = true;
            const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
            panelWrapper?.addClass('dragging');
        }
        
        event.preventDefault();
        
        const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
        if (!panelWrapper) return;

        const touch = event.touches[0];
        const x = touch.clientX - this.dragOffset.x;
        const y = touch.clientY - this.dragOffset.y;

        const maxX = window.innerWidth - (panelWrapper.offsetWidth || 150);
        const maxY = window.innerHeight - (panelWrapper.offsetHeight || 100);
        
        this.lastPosition = {
            x: Math.max(0, Math.min(x, maxX)),
            y: Math.max(0, Math.min(y, maxY))
        };

        panelWrapper.style.right = 'auto';
        panelWrapper.style.left = `${this.lastPosition.x}px`;
        panelWrapper.style.top = `${this.lastPosition.y}px`;
        panelWrapper.style.position = 'fixed';
    };

    private onTouchEnd = () => {
        this.dragPending = false;
        if (!this.isDragging) return;
        
        this.isDragging = false;
        const panelWrapper = document.body.querySelector('.minidoro-control-panel-wrapper') as HTMLElement;
        panelWrapper?.removeClass('dragging');
        
        if (this.hasDragged) {
            this.settings.panelX = this.lastPosition.x;
            this.settings.panelY = this.lastPosition.y;
            void this.saveData(this.settings);
        }
    };

    private getModeClass(): string {
        switch (this.currentMode) {
            case TimerState.Work: return 'minidoro-work-mode';
            case TimerState.ShortBreak: return 'minidoro-short-break-mode';
            case TimerState.LongBreak: return 'minidoro-long-break-mode';
            default: return 'minidoro-work-mode';
        }
    }

    private updateUI(remainingTime: number, totalTime: number) {
        if (!this.panelTimeEl || !this.panelModeEl) {
            return;
        }

        const timerState = this.timer.getState();
        const isOvertime = this.timer.isOvertime();
        
        if (this.pieCircleEl) {
            const allModeClasses = ['minidoro-work-mode', 'minidoro-short-break-mode', 'minidoro-long-break-mode', 'minidoro-overtime-mode'];
            this.pieCircleEl.removeClass(...allModeClasses);
            this.pieCircleEl.removeClass('minidoro-progress-complete', 'minidoro-progress-idle');

            if (isOvertime) {
                this.pieCircleEl.addClass('minidoro-overtime-mode');
            } else {
                this.pieCircleEl.addClass(this.getModeClass());
            }

            if (this.isSessionComplete) {
                this.containerEl?.addClass('session-complete');
            } else {
                this.containerEl?.removeClass('session-complete');
            }

            const radius = this.pieCircleEl.r.baseVal.value;
            const circumference = 2 * Math.PI * radius;
            
            let progress: number;
            if (isOvertime) {
                progress = 1;
            } else if (timerState === TimerState.Idle) {
                progress = 1; 
                this.pieCircleEl.addClass('minidoro-progress-idle');
            } else {
                progress = totalTime > 0 ? remainingTime / totalTime : 0;
                if (progress <= 0) {
                    this.pieCircleEl.addClass('minidoro-progress-complete');
                }
            }

            this.pieCircleEl.style.setProperty('--progress', progress.toString());
            this.pieCircleEl.style.setProperty('--circumference', circumference.toString());
        }

        const allModeClasses = ['minidoro-work-mode', 'minidoro-short-break-mode', 'minidoro-long-break-mode', 'minidoro-overtime-mode'];
        this.panelModeEl.removeClass(...allModeClasses, 'mode-enabled', 'mode-disabled');
        if (this.panelHeaderEl) {
            this.panelHeaderEl.removeClass(...allModeClasses);
        }

        if (isOvertime) {
            this.panelModeEl.addClass('minidoro-overtime-mode');
            if (this.panelHeaderEl) {
                this.panelHeaderEl.addClass('minidoro-overtime-mode');
                this.panelHeaderEl.addClass(this.getModeClass());
            }
        } else {
            const modeClass = this.getModeClass();
            this.panelModeEl.addClass(modeClass);
            if (this.panelHeaderEl) {
                this.panelHeaderEl.addClass(modeClass);
            }
        }

        if (this.panelHeaderEl) {
            if (this.currentMode === TimerState.Work && timerState === TimerState.Work) {
                this.panelHeaderEl.addClass('minidoro-spinning');
            } else {
                this.panelHeaderEl.removeClass('minidoro-spinning');
            }
            if (isOvertime) {
                this.panelHeaderEl.addClass('minidoro-overtime-pulse');
            } else {
                this.panelHeaderEl.removeClass('minidoro-overtime-pulse');
            }
            if (this.timer.isOvertimeLimitReached()) {
                this.panelHeaderEl.addClass('minidoro-overtime-limit');
            } else {
                this.panelHeaderEl.removeClass('minidoro-overtime-limit');
            }
        }

        const minutes = Math.floor(remainingTime / 60).toString().padStart(2, '0');
        const seconds = (remainingTime % 60).toString().padStart(2, '0');
        
        if (isOvertime) {
            this.panelTimeEl.setText(`${minutes}:${seconds}`);
        } else if (timerState === TimerState.Idle && !this.isSessionComplete) {
            this.panelTimeEl.setText(this.getIdleTimeText());
        } else {
            this.panelTimeEl.setText(`${minutes}:${seconds}`);
        }

        this.panelModeEl.setText(this.getModeText());

        if (isOvertime || (timerState === TimerState.Idle && !this.timer.isRunning())) {
            this.panelModeEl.addClass('mode-enabled');
        } else {
            this.panelModeEl.addClass('mode-disabled');
        }

        if (this.playButtonEl) {
            if (isOvertime && timerState === TimerState.Overtime) {
                setIcon(this.playButtonEl, 'pause');
                this.playButtonEl.setAttribute('title', 'Pause timer');
            } else if (timerState === TimerState.Idle || timerState === TimerState.Paused) {
                setIcon(this.playButtonEl, 'play');
                this.playButtonEl.setAttribute('title', 'Start timer');
            } else {
                setIcon(this.playButtonEl, 'pause');
                this.playButtonEl.setAttribute('title', 'Pause timer');
            }
        }
    }
    
    private getIdleTimeText = (): string => {
        const time = this.currentMode === TimerState.Work 
            ? this.settings.workTime 
            : this.currentMode === TimerState.ShortBreak 
                ? this.settings.shortBreakTime 
                : this.settings.longBreakTime;
        return `${time.toString().padStart(2, '0')}:00`;
    };

    private getModeText = (): string => {
        const translation = t(this.settings.language);
        if (this.timer.isOvertime()) {
            return translation.overtime;
        }
        return this.currentMode === TimerState.Work 
            ? translation.focus 
            : this.currentMode === TimerState.ShortBreak 
                ? translation.shortBreak 
                : translation.longBreak;
    };

    private getTranslation = () => t(this.settings.language);

    private handlePauseResumeClick = () => {
        if (this.isSessionComplete && !this.timer.isOvertime()) {
            if (this.timer.isRunning()) {
                this.isSessionComplete = false;
                this.timer.pause();
                return;
            }
            const shouldAutoStart = (this.currentMode === TimerState.Work && this.settings.autoStartBreaks) ||
                (this.currentMode !== TimerState.Work && this.settings.autoStartPomodoros);
            if (shouldAutoStart) {
                this.acknowledgeSessionComplete();
            } else {
                this.isSessionComplete = false;
                this.timer.reset();
                this.timer.start(this.currentMode);
            }
            return;
        }

        if (this.timer.isRunning() || this.timer.getState() === TimerState.Paused) {
            if (this.timer.getState() === TimerState.Paused) {
                this.timer.resume();
            } else {
                this.timer.pause();
            }
        } else {
            this.timer.start(this.currentMode);
        }
    };

    private handleResetClick = () => {
        if (this.timer.isOvertime()) {
            this.isSessionComplete = false;
            this.timer.stop();
            return;
        }
        this.isSessionComplete = false;
        this.timer.reset(); // reset() already calls updateUI via onTick callback
    };

    private handleCycleModeClick = () => {
        const translation = this.getTranslation();
        
        if (this.timer.isOvertime()) {
            new Notice(translation.resetToSwitchMode);
            return;
        }

        if (this.timer.getState() !== TimerState.Idle || this.timer.isRunning()) {
            new Notice(translation.resetToSwitchMode);
            return;
        }

        if (this.isSessionComplete) {
            const shouldAutoStart = (this.currentMode === TimerState.Work && this.settings.autoStartBreaks) ||
                (this.currentMode !== TimerState.Work && this.settings.autoStartPomodoros);
            if (shouldAutoStart) {
                this.acknowledgeSessionComplete();
                return;
            }
        }

        switch (this.currentMode) {
            case TimerState.Work: 
                this.currentMode = TimerState.ShortBreak; 
                break;
            case TimerState.ShortBreak: 
                this.currentMode = TimerState.LongBreak; 
                break;
            case TimerState.LongBreak: 
                this.currentMode = TimerState.Work; 
                break;
        }
        this.isSessionComplete = false;
        new Notice(translation.switchedToMode.replace('{mode}', this.getModeText()));
        this.updateUI(0, 0);
    };

    private handleCompleteClick = () => {
		const timerState = this.timer.getState();
		const translation = this.getTranslation();

		if (timerState === TimerState.Idle && !this.timer.isOvertime() && !this.isSessionComplete) {
			new Notice(translation.timerNotRunning);
			return;
		}

		this.timer.stop();

		if (!this.isSessionComplete) {
			if (this.settings.playSound) {
				this.playNotificationSound();
			}
			if (this.settings.showDesktopNotification) {
				this.showDesktopNotification();
			}

			const sessionType = this.getModeText();
			new Notice(translation.sessionCompleted.replace('{mode}', sessionType), 4000);
		}

		const wasWorkMode = this.currentMode === TimerState.Work;

		if (wasWorkMode) {
			this.completedPomodoros++;
			this.currentMode = (this.completedPomodoros % this.settings.longBreakInterval === 0)
				? TimerState.LongBreak
				: TimerState.ShortBreak;
		} else {
			this.currentMode = TimerState.Work;
		}

		if (wasWorkMode ? this.settings.autoStartBreaks : this.settings.autoStartPomodoros) {
			this.timer.start(this.currentMode);
		}

		this.isSessionComplete = false;
		if (!this.timer.isRunning()) {
			this.updateUI(this.timer.getRemainingTime(), this.timer.getTotalTime());
		}
	};

	private onTimerComplete() {
		this.isSessionComplete = true;

        if (this.settings.playSound) {
            this.playNotificationSound();
        }
        if (this.settings.showDesktopNotification) {
            this.showDesktopNotification();
        }

        const translation = this.getTranslation();
        const sessionType = this.getModeText();
        new Notice(translation.sessionCompleted.replace('{mode}', sessionType), 4000);

        if (this.settings.enableOvertime) {
            this.timer.startOvertime();
            this.updateUI(0, 0);
            return;
        }

        const shouldAutoStart = (this.currentMode === TimerState.Work && this.settings.autoStartBreaks) ||
            (this.currentMode !== TimerState.Work && this.settings.autoStartPomodoros);

        if (shouldAutoStart) {
            this.advanceToNextMode();
        } else {
            this.timer.stop();
        }
        this.updateUI(0, 0);
    }

    private playNotificationSound() {
        try {
            interface WindowWithWebkitAudioContext extends Window {
                webkitAudioContext?: typeof AudioContext;
            }
            
            const windowWithWebkit = window as WindowWithWebkitAudioContext;
            const AudioContextConstructor = window.AudioContext || windowWithWebkit.webkitAudioContext;
            
            if (!AudioContextConstructor) return;
            
            const audioContext = new AudioContextConstructor();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(1200, audioContext.currentTime + 0.2);
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 1);
        } catch (error) {
            console.warn('Could not play notification sound:', error);
        }
    }

    private showDesktopNotification() {
        if ('Notification' in window && Notification.permission === 'granted') {
            const translation = this.getTranslation();
            const sessionType = this.getModeText();
            
            const notification = new Notification(translation.notificationTitle.replace('{mode}', sessionType), {
                body: translation.notificationBody.replace('{mode_lower}', sessionType.toLowerCase()),
                icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJ0cmFuc3BhcmVudCIvPgo8L3N2Zz4K',
                requireInteraction: false,
                tag: 'pomodoro-timer',
                silent: false
            });

            setTimeout(() => {
                notification.close();
            }, 5000);
        }
    }

    private handleOvertimeReminder(elapsedMinutes: number) {
        const translation = this.getTranslation();
        const preOvertimeText = this.currentMode === TimerState.Work 
            ? translation.focus 
            : this.currentMode === TimerState.ShortBreak 
                ? translation.shortBreak 
                : translation.longBreak;
        const title = translation.overtimeReminderTitle;
        const body = translation.overtimeReminderBody
            .replace('{mode}', preOvertimeText)
            .replace('{mode_lower}', preOvertimeText.toLowerCase())
            .replace('{minutes}', elapsedMinutes.toString());
        new Notice(body, 4000);
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, tag: 'pomodoro-overtime', silent: false });
        }
    }

    private handleOvertimeLimitReached() {
        const translation = this.getTranslation();
        new Notice(translation.overtimeLimitReached, 4000);
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(translation.overtimeReminderTitle, {
                body: translation.overtimeLimitReached,
                tag: 'pomodoro-overtime-limit',
                silent: false
            });
        }
    }

    private advanceToNextMode() {
        if (this.currentMode === TimerState.Work) {
            this.completedPomodoros++;
            if (this.completedPomodoros % this.settings.longBreakInterval === 0) {
                this.nextMode = TimerState.LongBreak;
            } else {
                this.nextMode = TimerState.ShortBreak;
            }
        } else {
            this.nextMode = TimerState.Work;
        }

        if ((this.currentMode === TimerState.Work && this.settings.autoStartBreaks) ||
            (this.currentMode !== TimerState.Work && this.settings.autoStartPomodoros)) {
            
            setTimeout(() => {
                if (this.isSessionComplete) {
                    this.currentMode = this.nextMode;
                    this.timer.start(this.currentMode);
                }
            }, 1000);
        }
    }

    private acknowledgeSessionComplete() {
        this.isSessionComplete = false;
        if (!this.timer.isRunning()) {
            this.currentMode = this.nextMode;
        }
        this.updateUI(this.timer.getRemainingTime(), this.timer.getTotalTime());
    }

    private onTimerCompletion(state: TimerState) {
        // Handled in onTimerComplete
    }
}

class PomodoroSettingTab extends PluginSettingTab {
    plugin: PomodoroPlugin;
    
    constructor(app: App, plugin: PomodoroPlugin) { 
        super(app, plugin); 
        this.plugin = plugin; 
    }
    
    display(): void {
        const { containerEl } = this;
        const translation = t(this.plugin.settings.language);
        const settingsTrans = translation.settings;
        
        containerEl.empty();

        new Setting(containerEl)
            .setName(settingsTrans.language)
            .setDesc(settingsTrans.languageDesc)
            .addDropdown(dropdown => dropdown
                .addOption('en', settingsTrans.english)
                .addOption('zh', settingsTrans.chinese)
                .setValue(this.plugin.settings.language)
                .onChange(async (value) => {
                    this.plugin.settings.language = value as Language;
                    await this.plugin.saveSettings();
                    this.display();
                }));
        
        new Setting(containerEl)
            .setName(settingsTrans.panelSize)
            .setDesc(settingsTrans.panelSizeDesc)
            .addDropdown(dropdown => dropdown
                .addOption('small', settingsTrans.small)
                .addOption('medium', settingsTrans.medium)
                .addOption('large', settingsTrans.large)
                .setValue(this.plugin.settings.panelSize)
                .onChange(async (value) => {
                    this.plugin.settings.panelSize = value as 'small' | 'medium' | 'large';
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName(settingsTrans.workTime)
            .setDesc(settingsTrans.workTimeDesc)
            .addSlider(slider => slider
                .setLimits(1, 60, 1)
                .setValue(this.plugin.settings.workTime)
                .setDynamicTooltip()
                .onChange(async (value) => { 
                    this.plugin.settings.workTime = value; 
                    await this.plugin.saveSettings(); 
                }));
        
        new Setting(containerEl)
            .setName(settingsTrans.shortBreakTime)
            .setDesc(settingsTrans.shortBreakTimeDesc)
            .addSlider(slider => slider
                .setLimits(1, 60, 1)
                .setValue(this.plugin.settings.shortBreakTime)
                .setDynamicTooltip()
                .onChange(async (value) => { 
                    this.plugin.settings.shortBreakTime = value; 
                    await this.plugin.saveSettings(); 
                }));
        
        new Setting(containerEl)
            .setName(settingsTrans.longBreakTime)
            .setDesc(settingsTrans.longBreakTimeDesc)
            .addSlider(slider => slider
                .setLimits(1, 60, 1)
                .setValue(this.plugin.settings.longBreakTime)
                .setDynamicTooltip()
                .onChange(async (value) => { 
                    this.plugin.settings.longBreakTime = value; 
                    await this.plugin.saveSettings(); 
                }));

        new Setting(containerEl)
            .setName(settingsTrans.longBreakInterval)
            .setDesc(settingsTrans.longBreakIntervalDesc)
            .addSlider(slider => slider
                .setLimits(2, 10, 1)
                .setValue(this.plugin.settings.longBreakInterval)
                .setDynamicTooltip()
                .onChange(async (value) => { 
                    this.plugin.settings.longBreakInterval = value; 
                    await this.plugin.saveSettings(); 
                }));

        new Setting(containerEl)
            .setName(settingsTrans.autoStart)
            .setHeading();
        
        new Setting(containerEl)
            .setName(settingsTrans.autoStartBreaks)
            .setDesc(settingsTrans.autoStartBreaksDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoStartBreaks)
                .onChange(async (value) => {
                    this.plugin.settings.autoStartBreaks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(settingsTrans.autoStartPomodoros)
            .setDesc(settingsTrans.autoStartPomodorosDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoStartPomodoros)
                .onChange(async (value) => {
                    this.plugin.settings.autoStartPomodoros = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(settingsTrans.enableOvertime)
            .setDesc(settingsTrans.enableOvertimeDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableOvertime)
                .onChange(async (value) => {
                    this.plugin.settings.enableOvertime = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(settingsTrans.overtimeReminderInterval)
            .setDesc(settingsTrans.overtimeReminderIntervalDesc)
            .addSlider(slider => slider
                .setLimits(1, 30, 1)
                .setValue(this.plugin.settings.overtimeReminderInterval)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.overtimeReminderInterval = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(settingsTrans.overtimeLimit)
            .setDesc(settingsTrans.overtimeLimitDesc)
            .addSlider(slider => slider
                .setLimits(5, 30, 1)
                .setValue(this.plugin.settings.overtimeLimit)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.overtimeLimit = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(settingsTrans.notification)
            .setHeading();

        new Setting(containerEl)
            .setName(settingsTrans.playSound)
            .setDesc(settingsTrans.playSoundDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.playSound)
                .onChange(async (value) => {
                    this.plugin.settings.playSound = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(settingsTrans.desktopNotifications)
            .setDesc(settingsTrans.desktopNotificationsDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showDesktopNotification)
                .onChange(async (value) => {
                    this.plugin.settings.showDesktopNotification = value;
                    await this.plugin.saveSettings();
                }));
    }
}