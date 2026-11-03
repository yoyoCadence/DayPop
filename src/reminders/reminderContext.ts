import { createContext, useContext } from 'react';
import type { ReminderDeviceView } from './deviceController';
import type { ReminderRule, ReminderRuleInput } from './reminderService';

export interface ReminderContextValue {
  view: ReminderDeviceView;
  savingRule: boolean;
  refresh(): Promise<void>;
  enable(): Promise<boolean>;
  disable(): Promise<boolean>;
  reloadRule(calendarId: string): Promise<ReminderRule | null>;
  saveRule(input: ReminderRuleInput, expectedUpdatedAt: string | null): Promise<ReminderRule | null>;
}
export const ReminderContext = createContext<ReminderContextValue | null>(null);
/** Standalone screen fixtures may omit the runtime; they must never create a real subscription. */
export const useReminders = () => useContext(ReminderContext);
