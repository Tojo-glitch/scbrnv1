/**
 * lib/db.ts
 * All Supabase database operations — replaces localStorage calls in App.tsx
 *
 * Each function mirrors the localStorage pattern:
 *   localStorage  →  Supabase equivalent
 *   getTasks()    →  db.getTasks()
 *   saveTasks()   →  db.upsertTasks() / db.deleteTask()
 *   etc.
 */

import { supabase } from './supabaseClient';

// ─── Types (mirror App.tsx interfaces) ────────────────────────────────────

export interface DbSopStep {
  id: string;
  stepNumber: number;
  title: string;
  instruction: string;
  images?: string[];   // Storage paths OR base64 (legacy)
}

export interface DbTask {
  id: string;
  user_id?: string;
  name: string;
  type: 'hourly' | 'daily' | 'monthly';
  timing: string[];
  active: boolean;
  schedule_mode: 'all_days' | 'workdays' | 'holidays' | 'custom_days';
  custom_days: string[];
  handover_sop?: string;
  handover_image?: string;
  sop_steps: DbSopStep[];
  sort_order?: number;
}

export interface DbTaskNote {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  image?: string;
}

export interface DbTaskLog {
  id?: string;
  user_id?: string;
  task_id: string;
  log_date: string;       // 'YYYY-MM-DD'
  time_slot: string | null;
  actual_time: string;
  status: 'done' | 'skipped' | 'pending';
  note: string;
  notes: DbTaskNote[];
}

export interface DbShortnoteSubtask {
  id: string;
  text: string;
  done: boolean;
}

export interface DbShortnote {
  id: string;
  user_id?: string;
  text: string;
  done: boolean;
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  linked_task_id?: string;
  subtasks: DbShortnoteSubtask[];
  image?: string;
  note_date?: string;
}

export interface DbQaItem {
  id: string;
  user_id?: string;
  question: string;
  answer: string;
  category: 'handover' | 'system' | 'task' | 'other';
}

export interface DbUserSettings {
  workdays: string[];
}

// ─── Auth helpers ──────────────────────────────────────────────────────────

export async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

// ─── Tasks ─────────────────────────────────────────────────────────────────

export async function getTasks(): Promise<DbTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map(row => ({
    id:             row.id,
    name:           row.name,
    type:           row.type,
    timing:         row.timing ?? [],
    active:         row.active,
    schedule_mode:  row.schedule_mode,
    custom_days:    row.custom_days ?? [],
    handover_sop:   row.handover_sop ?? '',
    handover_image: row.handover_image ?? '',
    sop_steps:      (row.sop_steps ?? []).map((s: any) => ({
      ...s,
      images: s.images ?? (s.image ? [s.image] : []),
    })),
    sort_order:     row.sort_order ?? 0,
  }));
}

export async function upsertTask(task: DbTask): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from('tasks').upsert({
    id:             task.id,
    user_id:        userId,
    name:           task.name,
    type:           task.type,
    timing:         task.timing,
    active:         task.active,
    schedule_mode:  task.schedule_mode,
    custom_days:    task.custom_days,
    handover_sop:   task.handover_sop ?? null,
    handover_image: task.handover_image ?? null,
    sop_steps:      task.sop_steps,
    sort_order:     task.sort_order ?? 0,
  }, { onConflict: 'id' });

  if (error) throw error;
}

export async function upsertTasks(tasks: DbTask[]): Promise<void> {
  if (tasks.length === 0) return;
  const userId = await getCurrentUserId();

  const rows = tasks.map((task, idx) => ({
    id:             task.id,
    user_id:        userId,
    name:           task.name,
    type:           task.type,
    timing:         task.timing,
    active:         task.active,
    schedule_mode:  task.schedule_mode,
    custom_days:    task.custom_days,
    handover_sop:   task.handover_sop ?? null,
    handover_image: task.handover_image ?? null,
    sop_steps:      task.sop_steps,
    sort_order:     task.sort_order ?? idx,
  }));

  const { error } = await supabase
    .from('tasks')
    .upsert(rows, { onConflict: 'id' });

  if (error) throw error;
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId);

  if (error) throw error;
}

// ─── Task Logs ─────────────────────────────────────────────────────────────

/**
 * Get logs for a specific date range.
 * Pass a single date as both start and end to get one day.
 */
export async function getLogsByDate(
  dateStr: string,         // 'YYYY-MM-DD'
  daysBack: number = 0
): Promise<DbTaskLog[]> {
  const start = new Date(dateStr);
  start.setDate(start.getDate() - daysBack);
  const startStr = start.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('task_logs')
    .select('*')
    .gte('log_date', startStr)
    .lte('log_date', dateStr)
    .order('log_date', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(row => ({
    id:          row.id,
    task_id:     row.task_id,
    log_date:    row.log_date,
    time_slot:   row.time_slot,
    actual_time: row.actual_time,
    status:      row.status,
    note:        row.note,
    notes:       row.notes ?? [],
  }));
}

/**
 * Get all logs (for history view).
 * Limited to last 90 days to keep response size reasonable.
 */
export async function getAllLogs(): Promise<DbTaskLog[]> {
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('task_logs')
    .select('*')
    .gte('log_date', sinceStr)
    .order('log_date', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(row => ({
    id:          row.id,
    task_id:     row.task_id,
    log_date:    row.log_date,
    time_slot:   row.time_slot,
    actual_time: row.actual_time,
    status:      row.status,
    note:        row.note,
    notes:       row.notes ?? [],
  }));
}

export async function upsertLog(log: DbTaskLog): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from('task_logs').upsert({
    user_id:     userId,
    task_id:     log.task_id,
    log_date:    log.log_date,
    time_slot:   log.time_slot ?? null,
    actual_time: log.actual_time,
    status:      log.status,
    note:        log.note,
    notes:       log.notes,
  }, { onConflict: 'user_id,task_id,log_date,time_slot' });

  if (error) throw error;
}

export async function upsertLogs(logs: DbTaskLog[]): Promise<void> {
  if (logs.length === 0) return;
  const userId = await getCurrentUserId();

  const rows = logs.map(log => ({
    user_id:     userId,
    task_id:     log.task_id,
    log_date:    log.log_date,
    time_slot:   log.time_slot ?? null,
    actual_time: log.actual_time,
    status:      log.status,
    note:        log.note,
    notes:       log.notes,
  }));

  const { error } = await supabase
    .from('task_logs')
    .upsert(rows, { onConflict: 'user_id,task_id,log_date,time_slot' });

  if (error) throw error;
}

export async function deleteLogsForTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('task_logs')
    .delete()
    .eq('task_id', taskId);

  if (error) throw error;
}

// ─── Shortnotes ────────────────────────────────────────────────────────────

export async function getShortnotes(): Promise<DbShortnote[]> {
  const { data, error } = await supabase
    .from('shortnotes')
    .select('*')
    .eq('deleted', false)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(row => ({
    id:             row.id,
    text:           row.text,
    done:           row.done,
    pinned:         row.pinned,
    archived:       row.archived,
    deleted:        row.deleted,
    linked_task_id: row.linked_task_id ?? undefined,
    subtasks:       row.subtasks ?? [],
    image:          row.image ?? undefined,
    note_date:      row.note_date ?? undefined,
  }));
}

export async function upsertShortnote(note: DbShortnote): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from('shortnotes').upsert({
    id:             note.id,
    user_id:        userId,
    text:           note.text,
    done:           note.done,
    pinned:         note.pinned,
    archived:       note.archived,
    deleted:        note.deleted,
    linked_task_id: note.linked_task_id ?? null,
    subtasks:       note.subtasks,
    image:          note.image ?? null,
    note_date:      note.note_date ?? null,
  }, { onConflict: 'id' });

  if (error) throw error;
}

export async function upsertShortnotes(notes: DbShortnote[]): Promise<void> {
  if (notes.length === 0) return;
  const userId = await getCurrentUserId();

  const rows = notes.map(note => ({
    id:             note.id,
    user_id:        userId,
    text:           note.text,
    done:           note.done,
    pinned:         note.pinned,
    archived:       note.archived,
    deleted:        note.deleted,
    linked_task_id: note.linked_task_id ?? null,
    subtasks:       note.subtasks,
    image:          note.image ?? null,
    note_date:      note.note_date ?? null,
  }));

  const { error } = await supabase
    .from('shortnotes')
    .upsert(rows, { onConflict: 'id' });

  if (error) throw error;
}

// ─── QA Items ──────────────────────────────────────────────────────────────

export async function getQaItems(): Promise<DbQaItem[]> {
  const { data, error } = await supabase
    .from('qa_items')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map(row => ({
    id:       row.id,
    question: row.question,
    answer:   row.answer,
    category: row.category,
  }));
}

export async function upsertQaItem(qa: DbQaItem): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from('qa_items').upsert({
    id:       qa.id,
    user_id:  userId,
    question: qa.question,
    answer:   qa.answer,
    category: qa.category,
  }, { onConflict: 'id' });

  if (error) throw error;
}

export async function deleteQaItem(qaId: string): Promise<void> {
  const { error } = await supabase
    .from('qa_items')
    .delete()
    .eq('id', qaId);

  if (error) throw error;
}

// ─── User Settings ─────────────────────────────────────────────────────────

export async function getUserSettings(): Promise<DbUserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows

  return {
    workdays: data?.workdays ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  };
}

export async function saveUserSettings(settings: DbUserSettings): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from('user_settings').upsert({
    user_id:  userId,
    workdays: settings.workdays,
  }, { onConflict: 'user_id' });

  if (error) throw error;
}

// ─── Migration: localStorage → Supabase ────────────────────────────────────

/**
 * One-time migration: reads all data from localStorage and saves to Supabase.
 * Call this once after user logs in for the first time.
 * Returns true if migration happened, false if nothing to migrate.
 */
export async function migrateFromLocalStorage(): Promise<boolean> {
  const rawTasks      = localStorage.getItem('mbd_tasks');
  const rawLogs       = localStorage.getItem('mbd_logs');
  const rawShortnotes = localStorage.getItem('mbd_shortnotes');
  const rawQas        = localStorage.getItem('mbd_qas');
  const rawWorkdays   = localStorage.getItem('mbd_workdays');

  const hasSomething = rawTasks || rawLogs || rawShortnotes || rawQas;
  if (!hasSomething) return false;

  console.log('[Migration] Starting localStorage → Supabase migration...');

  try {
    if (rawTasks) {
      const tasks = JSON.parse(rawTasks);
      await upsertTasks(tasks.map((t: any, idx: number) => ({
        id:             t.id,
        name:           t.name,
        type:           t.type,
        timing:         t.timing ?? [],
        active:         t.active ?? true,
        schedule_mode:  t.scheduleMode ?? 'all_days',
        custom_days:    t.customDays ?? [],
        handover_sop:   t.handoverSop ?? '',
        handover_image: t.handoverImage ?? '',
        sop_steps:      (t.sopSteps ?? []).map((s: any) => ({
          ...s,
          images: s.images ?? (s.image ? [s.image] : []),
        })),
        sort_order: idx,
      })));
      console.log('[Migration] Tasks done:', tasks.length);
    }

    if (rawLogs) {
      const logs = JSON.parse(rawLogs);
      const mapped = logs
        .filter((l: any) => l.taskId && l.date)
        .map((l: any) => ({
          task_id:     l.taskId,
          log_date:    l.date,
          time_slot:   l.timeSlot ?? null,
          actual_time: l.actualTime ?? '',
          status:      l.done ? 'done' : (l.skipped ? 'skipped' : 'pending'),
          note:        l.note ?? '',
          notes:       l.notes ?? [],
        }));
      await upsertLogs(mapped);
      console.log('[Migration] Logs done:', mapped.length);
    }

    if (rawShortnotes) {
      const notes = JSON.parse(rawShortnotes);
      await upsertShortnotes(notes.map((n: any) => ({
        id:             n.id,
        text:           n.text ?? '',
        done:           n.done ?? false,
        pinned:         n.pinned ?? false,
        archived:       n.archived ?? false,
        deleted:        n.deleted ?? false,
        linked_task_id: n.linkedTaskId ?? undefined,
        subtasks:       n.subtasks ?? [],
        image:          n.image ?? undefined,
        note_date:      n.noteDate ?? undefined,
      })));
      console.log('[Migration] Shortnotes done:', notes.length);
    }

    if (rawQas) {
      const qas = JSON.parse(rawQas);
      for (const qa of qas) {
        await upsertQaItem({
          id:       qa.id,
          question: qa.question,
          answer:   qa.answer,
          category: qa.category ?? 'other',
        });
      }
      console.log('[Migration] QA items done:', qas.length);
    }

    if (rawWorkdays) {
      const workdays = JSON.parse(rawWorkdays);
      await saveUserSettings({ workdays });
      console.log('[Migration] Workdays done');
    }

    // Mark migration complete so we don't run again
    localStorage.setItem('mbd_migrated_to_supabase', 'true');
    console.log('[Migration] Complete! localStorage data preserved as backup.');
    return true;

  } catch (err) {
    console.error('[Migration] Failed:', err);
    throw err;
  }
}

export const db = {
  // Tasks
  getTasks,
  upsertTask,
  upsertTasks,
  deleteTask,
  // Logs
  getLogsByDate,
  getAllLogs,
  upsertLog,
  upsertLogs,
  deleteLogsForTask,
  // Shortnotes
  getShortnotes,
  upsertShortnote,
  upsertShortnotes,
  // QA
  getQaItems,
  upsertQaItem,
  deleteQaItem,
  // Settings
  getUserSettings,
  saveUserSettings,
  // Migration
  migrateFromLocalStorage,
};

export default db;