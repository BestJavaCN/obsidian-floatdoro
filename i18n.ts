import { Translation, Language } from './PomoTimer';

export const translations: Record<Language, Translation> = {
    en: {
        focus: 'Focus',
        shortBreak: 'Short break',
        longBreak: 'Long break',
        resetToSwitchMode: 'Reset the timer to switch modes',
        switchedToMode: 'Switched to {mode} mode',
        sessionCompleted: '{mode} session completed!',
        timerNotRunning: 'Timer not running',
        notificationTitle: 'Minidoro - {mode} complete',
        notificationBody: 'Your {mode_lower} session is finished.',
        settings: {
            workTime: 'Work time',
            workTimeDesc: 'Duration of focus sessions (seconds)',
            shortBreakTime: 'Short break time',
            shortBreakTimeDesc: 'Duration of short breaks (seconds)',
            longBreakTime: 'Long break time',
            longBreakTimeDesc: 'Duration of long breaks (seconds)',
            longBreakInterval: 'Sessions until long break',
            longBreakIntervalDesc: 'Number of focus sessions before a long break',
            autoStart: 'Auto-start',
            autoStartBreaks: 'Auto-start breaks',
            autoStartBreaksDesc: 'Automatically start break sessions',
            autoStartPomodoros: 'Auto-start focus sessions',
            autoStartPomodorosDesc: 'Automatically start focus sessions after breaks',
            notification: 'Notification',
            playSound: 'Play sound',
            playSoundDesc: 'Play a sound when sessions end',
            desktopNotifications: 'Desktop notifications',
            desktopNotificationsDesc: 'Show desktop notifications when sessions end',
            language: 'Language',
            languageDesc: 'Choose the display language',
            english: 'English',
            chinese: 'Chinese',
            panelSize: 'Panel size',
            panelSizeDesc: 'Size of the floating timer panel',
            small: 'Small',
            medium: 'Medium',
            large: 'Large'
        }
    },
    zh: {
        focus: '沉思',
        shortBreak: '小憩',
        longBreak: '长憩',
        resetToSwitchMode: '请重置计时器以切换模式',
        switchedToMode: '已切换到{mode}模式',
        sessionCompleted: '{mode}时段完成！',
        timerNotRunning: '番茄钟未运行',
        notificationTitle: 'Minidoro - {mode}完成',
        notificationBody: '您的{mode_lower}时段已结束。',
        settings: {
            workTime: '工作时间',
            workTimeDesc: '专注时段的时长（秒）',
            shortBreakTime: '短休息时间',
            shortBreakTimeDesc: '短休息的时长（秒）',
            longBreakTime: '长休息时间',
            longBreakTimeDesc: '长休息的时长（秒）',
            longBreakInterval: '长休息前的时段数',
            longBreakIntervalDesc: '长休息前的专注时段数量',
            autoStart: '自动开始',
            autoStartBreaks: '自动开始休息',
            autoStartBreaksDesc: '自动开始休息时段',
            autoStartPomodoros: '自动开始专注时段',
            autoStartPomodorosDesc: '休息后自动开始专注时段',
            notification: '通知',
            playSound: '播放声音',
            playSoundDesc: '时段结束时播放声音',
            desktopNotifications: '桌面通知',
            desktopNotificationsDesc: '时段结束时显示桌面通知',
            language: '语言',
            languageDesc: '选择显示语言',
            english: 'English',
            chinese: '中文',
            panelSize: '面板大小',
            panelSizeDesc: '悬浮计时器面板的大小',
            small: '小',
            medium: '中',
            large: '大'
        }
    }
};

export const t = (language: Language): Translation => {
    return translations[language] || translations.en;
};