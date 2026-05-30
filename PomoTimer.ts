import { Plugin } from 'obsidian';

export enum TimerState {
    Work,
    ShortBreak,
    LongBreak,
    Paused,
    Idle,
    Overtime
}

export type Language = 'en' | 'zh';

export interface Translation {
    focus: string;
    shortBreak: string;
    longBreak: string;
    resetToSwitchMode: string;
    switchedToMode: string;
    sessionCompleted: string;
		timerNotRunning: string;
		notificationTitle: string;
        notificationBody: string;
        overtime: string;
        settings: {
            workTime: string;
            workTimeDesc: string;
            shortBreakTime: string;
            shortBreakTimeDesc: string;
            longBreakTime: string;
            longBreakTimeDesc: string;
            longBreakInterval: string;
            longBreakIntervalDesc: string;
            autoStart: string;
            autoStartBreaks: string;
            autoStartBreaksDesc: string;
            autoStartPomodoros: string;
            autoStartPomodorosDesc: string;
            enableOvertime: string;
            enableOvertimeDesc: string;
            notification: string;
            playSound: string;
            playSoundDesc: string;
            desktopNotifications: string;
            desktopNotificationsDesc: string;
            language: string;
            languageDesc: string;
            english: string;
            chinese: string;
            panelSize: string;
            panelSizeDesc: string;
            small: string;
            medium: string;
            large: string;
        };
}

export class PomoTimer {
    private state: TimerState = TimerState.Idle;
    private prePauseState: TimerState = TimerState.Idle;
    private remainingTime: number = 0;
    private totalTime: number = 0;
    private targetTime: number | null = null;
    private overtimeElapsed: number = 0;
    private overtimeStartTime: number | null = null;
    private accumulatedOvertime: number = 0;
    private intervalId: number | null = null;
    private onTick: (remainingTime: number, totalTime: number) => void;
    private onStateChange: (state: TimerState) => void;
    private onTimerComplete: () => void;
    private settings: PomodoroSettings;
    private plugin: Plugin;

    constructor(
        plugin: Plugin,
        settings: PomodoroSettings, 
        onTick: (remainingTime: number, totalTime: number) => void, 
        onStateChange: (state: TimerState) => void,
        onTimerComplete: () => void
    ) {
        this.plugin = plugin;
        this.settings = settings;
        this.onTick = onTick;
        this.onStateChange = onStateChange;
        this.onTimerComplete = onTimerComplete;
    }

    public updateSettings(settings: PomodoroSettings) {
        this.settings = settings;
    }

    start(state: TimerState) {
        if (state === TimerState.Idle || state === TimerState.Paused || state === TimerState.Overtime) return;
        
        this.state = state;

        // Only reset time if it's a new session (not resuming)
        // We check <= 0 just to be safe, though usually it's exactly 0 when fresh
        if (this.remainingTime <= 0) {
            switch (this.state) {
                case TimerState.Work: 
                    this.remainingTime = this.settings.workTime * 60; 
                    break;
                case TimerState.ShortBreak: 
                    this.remainingTime = this.settings.shortBreakTime * 60; 
                    break;
                case TimerState.LongBreak: 
                    this.remainingTime = this.settings.longBreakTime * 60; 
                    break;
            }
            this.totalTime = this.remainingTime;
        }
        
        // BACKGROUND FIX:
        // Instead of relying on the interval to count down, we calculate the 
        // specific timestamp when the timer should end.
        this.targetTime = Date.now() + (this.remainingTime * 1000);

        if (this.intervalId) {
            window.clearInterval(this.intervalId);
        }

        // Use plugin.registerInterval to ensure cleanup
        this.intervalId = this.plugin.registerInterval(window.setInterval(() => {
            if (!this.targetTime) return;

            const now = Date.now();
            // Calculate remaining seconds based on real time difference
            // This prevents "drift" if the window is backgrounded/throttled
            const diff = Math.ceil((this.targetTime - now) / 1000);
            
            this.remainingTime = diff;
            this.onTick(this.remainingTime, this.totalTime);
            
            if (this.remainingTime <= 0) {
                // Ensure we don't show negative numbers
                this.remainingTime = 0;
                const completedState = this.state;
                this.stop();
                this.onTimerComplete();
                this.onStateChange(completedState);
            }
        }, 1000));
        
        // Immediate update
        this.onTick(this.remainingTime, this.totalTime);
    }

    pause() {
        if (this.intervalId && this.state !== TimerState.Idle && this.state !== TimerState.Paused) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
            this.prePauseState = this.state;
            this.state = TimerState.Paused;
            this.targetTime = null;
            if (this.prePauseState === TimerState.Overtime) {
                this.accumulatedOvertime = this.overtimeElapsed;
                this.overtimeStartTime = null;
                this.onTick(this.overtimeElapsed, 0);
            } else {
                this.onTick(this.remainingTime, this.totalTime);
            }
        }
    }

    resume() {
        if (this.state === TimerState.Paused) {
            if (this.prePauseState === TimerState.Overtime) {
                this.resumeOvertime();
            } else {
                this.start(this.prePauseState);
            }
        }
    }

    stop() {
        if (this.intervalId) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.state = TimerState.Idle;
        this.remainingTime = 0;
        this.totalTime = 0;
        this.targetTime = null;
        this.overtimeElapsed = 0;
        this.accumulatedOvertime = 0;
        this.overtimeStartTime = null;
        this.onTick(this.remainingTime, this.totalTime);
    }

    reset() {
        this.stop();
        this.onTick(0, 0);
    }

    startOvertime() {
        this.state = TimerState.Overtime;
        this.overtimeElapsed = 0;
        this.accumulatedOvertime = 0;
        this.overtimeStartTime = Date.now();

        if (this.intervalId) {
            window.clearInterval(this.intervalId);
        }

        this.intervalId = this.plugin.registerInterval(window.setInterval(() => {
            if (!this.overtimeStartTime) return;
            const now = Date.now();
            this.overtimeElapsed = this.accumulatedOvertime + Math.floor((now - this.overtimeStartTime) / 1000);
            this.onTick(this.overtimeElapsed, 0);
        }, 1000));

        this.onTick(this.overtimeElapsed, 0);
    }

    private resumeOvertime() {
        this.state = TimerState.Overtime;
        this.overtimeStartTime = Date.now();

        if (this.intervalId) {
            window.clearInterval(this.intervalId);
        }

        this.intervalId = this.plugin.registerInterval(window.setInterval(() => {
            if (!this.overtimeStartTime) return;
            const now = Date.now();
            this.overtimeElapsed = this.accumulatedOvertime + Math.floor((now - this.overtimeStartTime) / 1000);
            this.onTick(this.overtimeElapsed, 0);
        }, 1000));

        this.onTick(this.overtimeElapsed, 0);
    }

    getOvertimeElapsed(): number {
        return this.overtimeElapsed;
    }

    getState(): TimerState {
        return this.state;
    }

    getRemainingTime(): number {
        if (this.state === TimerState.Overtime || this.prePauseState === TimerState.Overtime) {
            return this.overtimeElapsed;
        }
        return this.remainingTime;
    }

    getTotalTime(): number {
        if (this.state === TimerState.Overtime || this.prePauseState === TimerState.Overtime) {
            return 0;
        }
        return this.totalTime;
    }

    isRunning(): boolean {
        return this.state !== TimerState.Idle && this.state !== TimerState.Paused;
    }

    isOvertime(): boolean {
        return this.state === TimerState.Overtime ||
            (this.state === TimerState.Paused && this.prePauseState === TimerState.Overtime);
    }
}

export interface PomodoroSettings {
    workTime: number;
    shortBreakTime: number;
    longBreakTime: number;
    longBreakInterval: number;
    autoStartBreaks: boolean;
    autoStartPomodoros: boolean;
    enableOvertime: boolean;
    showDesktopNotification: boolean;
    playSound: boolean;
    showInStatusBar: boolean;
    language: Language;
    panelSize: 'small' | 'medium' | 'large';
    panelX?: number;
    panelY?: number;
}

export const DEFAULT_SETTINGS: PomodoroSettings = {
    workTime: 25,  // minutes
    shortBreakTime: 5,  // minutes
    longBreakTime: 15,  // minutes
    longBreakInterval: 4,
    autoStartBreaks: false,
    autoStartPomodoros: false,
    enableOvertime: false,
    showDesktopNotification: true,
    playSound: true,
    showInStatusBar: false,
    language: 'en',
    panelSize: 'medium'
};