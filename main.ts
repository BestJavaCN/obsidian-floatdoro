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
    private containerEl: HTMLDivElement | null = null;
    private controlPanelEl: HTMLDivElement | null = null;
    private pieCircleEl: SVGCircleElement | null = null;
    private panelTimeEl: HTMLButtonElement | null = null;
    private panelModeEl: HTMLDivElement | null = null;
    private isVisible = true;

    // Drag related variables
    private isDragging = false;
    private dragOffset = { x: 0, y: 0 };
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
            () => this.onTimerComplete()
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
            name: 'Toggle timer visibility',
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
        });
    }

    onunload() {
        this.removeFloatingPanel();
        this.timer.stop();
    }

    async loadSettings() { 
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); 
    }
    
    async saveSettings() { 
        await this.saveData(this.settings); 
        this.timer.updateSettings(this.settings); 
        this.updateUI(0, 0); 
    }

    private createFloatingPanel() {
        // Remove existing panel if any
        this.removeFloatingPanel();

        // Create main container
        this.containerEl = document.body.createEl('div', { cls: 'minidoro-container' });

        // Load saved position if available
        if (this.settings.panelX !== undefined && this.settings.panelY !== undefined) {
            // Clear right and use left for positioning
            this.containerEl.style.right = 'auto';
            this.containerEl.style.left = `${this.settings.panelX}px`;
            this.containerEl.style.top = `${this.settings.panelY}px`;
            this.lastPosition = { x: this.settings.panelX, y: this.settings.panelY };
        }

        // Create close button
        const closeButton = this.containerEl.createEl('button', { cls: 'minidoro-close-button' });
        closeButton.innerHTML = '&times;';
        closeButton.onclick = () => this.toggleVisibility();

        // Create pie button
        const pieButton = this.containerEl.createEl('button', { cls: 'minidoro-pie-button' });
        pieButton.setAttribute('aria-label', 'Minidoro timer');
        pieButton.onclick = (event) => {
            event.stopPropagation();
            if (this.isSessionComplete) {
                this.acknowledgeSessionComplete();
            }
        };
        
        // SVG Creation using setIcon
        setIcon(pieButton, 'minidoro-timer');

        // Retrieve the reference to the dynamic circle element
        this.pieCircleEl = pieButton.querySelector('.minidoro-progress-circle');

        // Create control panel
        this.createControlPanel();

        // Add drag event listeners
        this.containerEl.addEventListener('mousedown', this.onDragStart);
        document.addEventListener('mousemove', this.onDragMove);
        document.addEventListener('mouseup', this.onDragEnd);

        // Update UI
        this.updateUI(0, 0);
    }

    private createControlPanel() {
        if (!this.containerEl) return;
        this.controlPanelEl = this.containerEl.createEl('div', { cls: 'minidoro-control-panel' });
        this.panelModeEl = this.controlPanelEl.createEl('div', { 
            cls: 'minidoro-panel-mode', 
            attr: { 
                'title': 'Click to switch mode (only when timer is reset)',
                'role': 'button',
                'tabindex': '0'
            } 
        });
        this.panelModeEl.onclick = () => this.handleCycleModeClick();
        
        this.panelTimeEl = this.controlPanelEl.createEl('button', { 
            cls: 'minidoro-panel-time', 
            attr: { 'title': 'Left click - play/pause, right click - reset' }
        });
        this.panelTimeEl.onclick = () => this.handlePauseResumeClick();
        this.panelTimeEl.oncontextmenu = (e) => { 
            e.preventDefault(); 
            this.handleResetClick(); 
        };
    }

    private removeFloatingPanel() {
        // Save position before removing
        if (this.containerEl) {
            const rect = this.containerEl.getBoundingClientRect();
            this.settings.panelX = rect.left;
            this.settings.panelY = rect.top;
            void this.saveData(this.settings);
            
            this.containerEl.removeEventListener('mousedown', this.onDragStart);
            this.containerEl.remove();
        }
        
        this.containerEl = this.controlPanelEl = this.pieCircleEl = this.panelTimeEl = this.panelModeEl = null;
        this.isVisible = false;
    }

    private toggleVisibility() {
        if (!this.containerEl) {
            // Create panel if it doesn't exist
            this.createFloatingPanel();
        } else {
            // Toggle visibility
            if (this.isVisible) {
                this.containerEl.style.display = 'none';
                this.isVisible = false;
            } else {
                this.containerEl.style.display = 'flex';
                this.isVisible = true;
            }
        }
    }

    private onDragStart = (event: MouseEvent) => {
        // Prevent dragging when clicking buttons inside
        if ((event.target as HTMLElement).closest('button')) {
            return;
        }
        
        this.isDragging = true;
        this.containerEl?.addClass('dragging');
        
        const rect = this.containerEl?.getBoundingClientRect();
        if (rect) {
            this.dragOffset = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
        }
    };

    private onDragMove = (event: MouseEvent) => {
        if (!this.isDragging || !this.containerEl) return;

        const x = event.clientX - this.dragOffset.x;
        const y = event.clientY - this.dragOffset.y;

        // Ensure panel stays within viewport
        const maxX = window.innerWidth - (this.containerEl.offsetWidth || 150);
        const maxY = window.innerHeight - (this.containerEl.offsetHeight || 100);
        
        this.lastPosition = {
            x: Math.max(0, Math.min(x, maxX)),
            y: Math.max(0, Math.min(y, maxY))
        };

        // Clear right and use left for positioning
        this.containerEl.style.right = 'auto';
        this.containerEl.style.left = `${this.lastPosition.x}px`;
        this.containerEl.style.top = `${this.lastPosition.y}px`;
    };

    private onDragEnd = () => {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        this.containerEl?.removeClass('dragging');
        
        // Save position to settings
        this.settings.panelX = this.lastPosition.x;
        this.settings.panelY = this.lastPosition.y;
        void this.saveData(this.settings);
    };

    private updateUI(remainingTime: number, totalTime: number) {
        if (!this.pieCircleEl || !this.panelTimeEl || !this.panelModeEl) return;

        const timerState = this.timer.getState();
        
        // Remove all mode classes first
        this.pieCircleEl.removeClass('minidoro-work-mode', 'minidoro-break-mode');
        this.panelModeEl.removeClass('minidoro-work-mode', 'minidoro-break-mode', 'mode-enabled', 'mode-disabled');
        this.pieCircleEl.removeClass('minidoro-progress-complete', 'minidoro-progress-idle');

        // Add appropriate mode class
        const isWorkMode = this.currentMode === TimerState.Work;
        const modeClass = isWorkMode ? 'minidoro-work-mode' : 'minidoro-break-mode';
        this.pieCircleEl.addClass(modeClass);
        this.panelModeEl.addClass(modeClass);

        // Update pie chart progress
        const radius = this.pieCircleEl.r.baseVal.value;
        const circumference = 2 * Math.PI * radius;
        
        let progress: number;
        if (timerState === TimerState.Idle) {
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

        // Add session complete animation
        if (this.isSessionComplete) {
            this.containerEl?.addClass('session-complete');
        } else {
            this.containerEl?.removeClass('session-complete');
        }

        // Update time display
        const minutes = Math.floor(remainingTime / 60).toString().padStart(2, '0');
        const seconds = (remainingTime % 60).toString().padStart(2, '0');
        
        if (timerState === TimerState.Idle) {
            this.panelTimeEl.setText(this.getIdleTimeText());
        } else {
            this.panelTimeEl.setText(`${minutes}:${seconds}`);
        }

        this.panelModeEl.setText(this.getModeText());

        if (timerState === TimerState.Idle && !this.timer.isRunning()) {
            this.panelModeEl.addClass('mode-enabled');
        } else {
            this.panelModeEl.addClass('mode-disabled');
        }
    }
    
    private getIdleTimeText = (): string => {
        const time = this.currentMode === TimerState.Work 
            ? this.settings.workTime 
            : this.currentMode === TimerState.ShortBreak 
                ? this.settings.shortBreakTime 
                : this.settings.longBreakTime;
        return `${time}:00`;
    };

    private getModeText = (): string => {
        const translation = t(this.settings.language);
        return this.currentMode === TimerState.Work 
            ? translation.focus 
            : this.currentMode === TimerState.ShortBreak 
                ? translation.shortBreak 
                : translation.longBreak;
    };

    private getTranslation = () => t(this.settings.language);

    private handlePauseResumeClick = () => {
        if (this.isSessionComplete) {
            this.acknowledgeSessionComplete();
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
        this.timer.reset();
        this.isSessionComplete = false;
        this.updateUI(0, 0);
    };

    private handleCycleModeClick = () => {
        const translation = this.getTranslation();
        
        if (this.timer.getState() !== TimerState.Idle || this.timer.isRunning()) {
            new Notice(translation.resetToSwitchMode);
            return;
        }

        if (this.isSessionComplete) {
            this.acknowledgeSessionComplete();
            return;
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
        new Notice(translation.switchedToMode.replace('{mode}', this.getModeText()));
        this.updateUI(0, 0);
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

        this.advanceToNextMode();
        this.updateUI(0, 0);

        setTimeout(() => {
            this.acknowledgeSessionComplete();
        }, 10000);
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
            .setName(settingsTrans.workTime)
            .setDesc(settingsTrans.workTimeDesc)
            .addSlider(slider => slider
                .setLimits(1, 60, 2)
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
                .setLimits(1, 30, 1)
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