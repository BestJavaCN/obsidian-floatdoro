import { App, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, addIcon, setIcon } from 'obsidian';
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
    private isPanelPinned = false;
    private hideTimeout: number | null = null;

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

        // Register active leaf change event
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.refreshHeaderButton(leaf)));
        this.app.workspace.onLayoutReady(() => this.refreshHeaderButton());

        // Register DOM event for document click to ensure cleanup
        this.registerDomEvent(document, 'click', (event: MouseEvent) => {
            this.handleDocumentClick(event);
        });

        // Request notification permission on startup
        if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission().catch(err => console.error("Minidoro: Error requesting notification permission", err));
        }
    }

    onunload() {
        // Clear any pending timeouts
        if (this.hideTimeout !== null) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
        
        this.removeHeaderButton();
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

    private refreshHeaderButton(leaf: WorkspaceLeaf | null = null) {
        this.removeHeaderButton();
        
        // Fixed: activeLeaf is deprecated. Use getLeaf(false) to get the most recent leaf.
        const targetLeaf = leaf || this.app.workspace.getLeaf(false);
        
        if (!targetLeaf) return;

        setTimeout(() => {
            // Check if view exists on the leaf
            if (!targetLeaf.view) return;
            
            const actionsContainer = targetLeaf.view.containerEl.querySelector('.view-actions');
            if (actionsContainer && !actionsContainer.querySelector('.minidoro-container')) {
                this.createHeaderButton(actionsContainer);
                this.updateUI(0, 0);
            }
        }, 0);
    }

    private createHeaderButton(parent: Element) {
        this.containerEl = parent.createEl('div', { cls: 'minidoro-container' });

        // Event Listeners for Hover
        this.containerEl.addEventListener('mouseenter', this.showPanel);
        this.containerEl.addEventListener('mouseleave', this.hidePanel);

        const pieButton = this.containerEl.createEl('button', { cls: 'minidoro-pie-button' });
        pieButton.setAttribute('aria-label', 'Minidoro timer');
        pieButton.onclick = (event) => {
            event.stopPropagation();
            if (this.isSessionComplete) {
                this.acknowledgeSessionComplete();
            } else {
                this.isPanelPinned = !this.isPanelPinned;
            }
        };
        
        // SVG Creation using setIcon
        // We use the custom icon registered in onload
        setIcon(pieButton, 'minidoro-timer');

        // Retrieve the reference to the dynamic circle element so we can animate it
        this.pieCircleEl = pieButton.querySelector('.minidoro-progress-circle');
        
        parent.prepend(this.containerEl);
        
        this.createControlPanel();
        
        // 默认显示面板，无需鼠标悬停
        this.isPanelPinned = true;
        this.controlPanelEl?.addClass('is-panel-visible');
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

    private removeHeaderButton() {
        // Clear any pending hide timeout
        if (this.hideTimeout !== null) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
        
        this.containerEl?.remove();
        this.containerEl = this.controlPanelEl = this.pieCircleEl = this.panelTimeEl = this.panelModeEl = null;
        this.isPanelPinned = false;
    }

    private showPanel = () => {
        if (this.hideTimeout !== null) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
        this.controlPanelEl?.addClass('is-panel-visible');
    };
    
    private hidePanel = () => { 
        if (!this.isPanelPinned) {
            this.hideTimeout = window.setTimeout(() => {
                this.controlPanelEl?.removeClass('is-panel-visible');
                this.hideTimeout = null;
            }, 300);
        }
    };
    
    private handleDocumentClick = (event: MouseEvent) => {
        // 点击外部不再取消固定，面板会一直显示直到再次点击计时器按钮
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