import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabaseClient';
import db from './lib/db';
import { uploadImage, uploadImages, resolveImageUrl, isStoragePath } from './lib/storage';
import { 
  Check, 
  Plus, 
  Trash2, 
  Edit3, 
  Calendar as CalendarIcon, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  CornerDownRight, 
  FileText,
  ChevronLeft,
  ChevronRight,
  Settings,
  X,
  Sparkles,
  Info,
  Pin,
  LayoutDashboard,
  Layers,
  History as HistoryIcon,
  Link2,
  AlertTriangle,
  Archive,
  Camera,
  BookOpen,
  Search,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  LogOut
} from 'lucide-react';

// --- TYPES ---
interface SopStep {
  id: string;
  stepNumber: number;
  title: string;
  instruction: string;
  image?: string; // legacy single image (kept for migration)
  images?: string[]; // new: multiple images per step
}

interface Task {
  id: string;
  name: string;
  type: 'hourly' | 'daily' | 'monthly';
  timing: string[]; // For hourly: e.g. ['09:00', '10:00']. For monthly: e.g. ['1', '25'].
  active: boolean;
  scheduleMode: 'all_days' | 'workdays' | 'holidays' | 'custom_days';
  customDays: string[]; // e.g. ['Mon', 'Tue', ...]
  handoverSop?: string; // Detailed SOP / Handover tutorial
  handoverImage?: string; // Reference image for instruction (base64 string)
  sopSteps?: SopStep[]; // Structured steps
}

interface TaskNote {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  image?: string; // Base64 data URI of proof/evidence image
}

interface LogItem {
  taskId: string;
  timeSlot?: string; // e.g. '09:00' for hourly tasks
  actualTime: string;
  status: 'done' | 'skipped' | 'pending';
  note: string;
  notes?: TaskNote[];
}

interface ShortnoteSubtask {
  id: string;
  text: string;
  done: boolean;
}

interface Shortnote {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  pinned?: boolean;
  linkedTaskId?: string;
  subtasks?: ShortnoteSubtask[];
  date?: string; // e.g. '2026-06-25'
  archived?: boolean;
  deleted?: boolean;
  image?: string; // Base64 proof image
}

type ViewType = 'dashboard' | 'management' | 'history' | 'qa';
type DashboardRoutineFilterType = 'all' | 'daily' | 'monthly';
type HistoryFilterType = 'all' | 'overdue' | 'notes';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const DEFAULT_QA_ITEMS = [
  { id: 'qa1', question: 'วิธีส่งต่องานเวรเช้าไปเวรบ่ายอย่างไรให้ถูกต้อง?', answer: 'ให้สรุปผลการทำงานลงในช่องบันทึกส่งมอบงาน (Handover Report Note) ของกิจกรรมนั้นๆ จากนั้นระบบจะแสดงสถานะ "ส่งต่อเวรแล้ว" เป็นสีส้ม', category: 'handover', createdAt: new Date().toISOString() },
  { id: 'qa2', question: 'ระบบคลังภารกิจล่มหรือโปรแกรมใช้งานไม่ได้ ต้องทำอย่างไร?', answer: '1. กดรีเฟรช (F5)\n2. ตรวจสอบอินเทอร์เน็ต\n3. แจ้งผู้ดูแลระบบ', category: 'system', createdAt: new Date().toISOString() },
  { id: 'qa3', question: 'หากจำเป็นต้องเช็คอีเมลหรือเช็คงานล่าช้ากว่ากำหนด ควรทำอย่างไร?', answer: 'ให้ดำเนินการให้เรียบร้อยโดยเร็วที่สุด แล้วพิมพ์สาเหตุที่ล่าช้าในบันทึกย่อยพร้อมแนบหลักฐาน', category: 'task', createdAt: new Date().toISOString() },
  { id: 'qa4', question: 'การแก้ไขหรือลบภารกิจออกจากคลัง จะมีผลกระทบต่อรายงานย้อนหลังหรือไม่?', answer: 'ไม่กระทบ ข้อมูลประวัติงานจะถูกบันทึกถาวรลงประวัติย้อนหลังเสมอ', category: 'system', createdAt: new Date().toISOString() },
  { id: 'qa5', question: 'ฉันสามารถแนบรูปภาพเป็นหลักฐานการทำงานได้ที่ส่วนไหนบ้าง?', answer: 'แนบได้ 2 ส่วน: 1. โน้ตย่อยในแต่ละภารกิจ 2. Quick Memo Dump popup', category: 'task', createdAt: new Date().toISOString() },
];

const INITIAL_TASKS: Task[] = [
  { 
    id: 't1', 
    name: 'เช็คอีเมล สำรวจความพร้อมรายวัน (Inbox Review)', 
    type: 'hourly', 
    timing: ['09:00'], 
    active: true, 
    scheduleMode: 'workdays', 
    customDays: [],
    handoverSop: 'คู่มือสอนงาน (SOP) - เช็คอีเมลรายวัน:\n\n1. เข้าสู่ระบบอีเมลหลักของแผนก\n2. ตรวจสอบจดหมายขาเข้าที่ยังไม่ได้อ่าน\n3. จัดระดับความสำคัญของอีเมล:\n   - สำคัญเร่งด่วน: ส่งเข้ากลุ่มแชตแจ้งทีมทันที\n   - สำคัญแต่ไม่เร่งด่วน: ปักธงติดตามงานตอบกลับภายในวัน\n   - ทั่วไป: อ่านและจัดหมวดหมู่ลงโฟลเดอร์ให้เป็นระเบียบ\n4. ตรวจสอบกล่องสแปมเผื่อมีเอกสารสำคัญหลุดรอด'
  },
  { 
    id: 't2', 
    name: 'อัปเดตทีมประจำวัน (Daily Standup Sync)', 
    type: 'hourly', 
    timing: ['10:00'], 
    active: true, 
    scheduleMode: 'workdays', 
    customDays: [],
    handoverSop: 'คู่มือจัดประชุมทีม Standup Sync:\n\n1. กดเปิดลิงก์ห้องประชุมประจำทีม (เช่น Google Meet)\n2. เรียกชื่อสมาชิกรายงานตามลำดับ สมาชิกแต่ละคนอัปเดต 3 ประเด็นหลัก:\n   - สิ่งที่ทำเสร็จไปเมื่อวานนี้\n   - สิ่งที่จะลุยต่อในวันนี้\n   - ปัญหาหรือสิ่งติดขัดสะดุดงาน (Blockers)\n3. บันทึกรายงานสั้นลงแชตกลุ่มเพื่อเป็นหลักฐานสรุปงานประจำวัน'
  },
  { id: 't3', name: 'ทานวิตามินเสริมและน้ำเปล่า 1 แก้วใหญ่', type: 'daily', timing: [], active: true, scheduleMode: 'all_days', customDays: [] },
  { id: 't4', name: 'ออกกำลังกายยืดหยุ่นกล้ามเนื้อยามเย็น', type: 'daily', timing: [], active: true, scheduleMode: 'all_days', customDays: [] },
  { id: 't5', name: 'สรุปบัญชีและวางแผนการเงินประจำเดือน', type: 'monthly', timing: ['1'], active: true, scheduleMode: 'all_days', customDays: [] },
  { id: 't6', name: 'ตรวจสอบเป้าหมายชีวิตและจัดระเบียบตู้โต๊ะทำงาน', type: 'monthly', timing: ['25'], active: true, scheduleMode: 'all_days', customDays: [] },
];

// ─── Rich Text Editor ──────────────────────────────────────────────────────
// Lightweight contentEditable-based editor with formatting toolbar.
// Stores content as sanitized HTML string in step.instruction.

const RICH_TEXT_SIZES = [
  { label: 'เล็ก', value: '12px' },
  { label: 'ปกติ', value: '14px' },
  { label: 'ใหญ่', value: '18px' },
  { label: 'ใหญ่มาก', value: '24px' },
];

function sanitizeRichHtml(html: string): string {
  // Strip script/style tags and event handler attributes — basic XSS guard
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
  return clean;
}

function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Sync external value changes into the editor (e.g. switching between steps)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    if (editorRef.current) onChange(sanitizeRichHtml(editorRef.current.innerHTML));
  };

  const applyFontSize = (size: string) => {
    editorRef.current?.focus();
    document.execCommand('fontSize', false, '7'); // use placeholder size 7
    if (editorRef.current) {
      // Replace all <font size="7"> with actual px size via span
      const fonts = editorRef.current.querySelectorAll('font[size="7"]');
      fonts.forEach(f => {
        const span = document.createElement('span');
        span.style.fontSize = size;
        span.innerHTML = f.innerHTML;
        f.replaceWith(span);
      });
      onChange(sanitizeRichHtml(editorRef.current.innerHTML));
    }
  };

  const applyHighlight = () => exec('hiliteColor', '#FDE68A');
  const applyRed = () => exec('foreColor', '#DC2626');
  const applyBlue = () => exec('foreColor', '#2563EB');
  const clearColor = () => exec('foreColor', '#121212');

  const btnClass = "w-7 h-7 flex items-center justify-center rounded border border-black/10 bg-white hover:bg-black/5 active:scale-95 transition-all cursor-pointer text-[#121212]";

  return (
    <div className={`border rounded-lg overflow-hidden transition-all ${isFocused ? 'border-black ring-1 ring-black/10' : 'border-black/10'}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap bg-[#F9F9F7] border-b border-black/10 px-2 py-1.5">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} className={btnClass} title="ตัวหนา">
          <span className="font-black text-xs">B</span>
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} className={btnClass} title="ขีดเส้นใต้">
          <span className="text-xs underline">U</span>
        </button>
        <div className="w-px h-5 bg-black/10 mx-0.5" />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={applyRed} className={btnClass} title="ตัวอักษรสีแดง">
          <span className="w-3.5 h-3.5 rounded-full bg-red-600 block" />
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={applyBlue} className={btnClass} title="ตัวอักษรสีน้ำเงิน">
          <span className="w-3.5 h-3.5 rounded-full bg-blue-600 block" />
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={applyHighlight} className={btnClass} title="ไฮไลต์สีเหลือง">
          <span className="w-3.5 h-3.5 rounded-full bg-yellow-300 border border-yellow-500 block" />
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={clearColor} className={btnClass} title="ล้างสีตัวอักษร">
          <X className="w-3 h-3" />
        </button>
        <div className="w-px h-5 bg-black/10 mx-0.5" />
        <select
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => { if (e.target.value) applyFontSize(e.target.value); e.target.value = ''; }}
          defaultValue=""
          className="h-7 text-[10px] font-bold bg-white border border-black/10 rounded px-1.5 cursor-pointer text-[#121212] focus:outline-none"
          style={{ colorScheme: 'light' }}
          title="ขนาดตัวอักษร"
        >
          <option value="" disabled>ขนาด</option>
          {RICH_TEXT_SIZES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onInput={() => {
          if (editorRef.current) onChange(sanitizeRichHtml(editorRef.current.innerHTML));
        }}
        data-placeholder={placeholder}
        className="w-full min-h-[60px] px-3 py-2 text-sm leading-relaxed text-[#121212] focus:outline-none bg-white [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-black/30"
        style={{ wordBreak: 'break-word' }}
      />
    </div>
  );
}

// Render rich HTML safely for display (read-only views)
function RichTextDisplay({ html, className }: { html: string; className?: string }) {
  if (!html || html.trim() === '') return null;
  return (
    <div
      className={className}
      style={{ wordBreak: 'break-word' }}
      dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(html) }}
    />
  );
}

export default function App({ session }: { session: Session }) {
  const userId = session.user.id;

  // --- DB LOADING STATE ---
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError,   setDbError]   = useState<string | null>(null);
  // --- STATE ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<Record<string, LogItem[]>>({});
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [dashboardRoutineFilter, setDashboardRoutineFilter] = useState<DashboardRoutineFilterType>('all');
  
  // Workdays Config State
  const [workdays, setWorkdays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [showSettings, setShowSettings] = useState(false);

  // Quick Add State
  const [quickAddText, setQuickAddText] = useState('');
  
  // Form State
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'hourly' | 'daily' | 'monthly'>('hourly');
  const [formScheduleMode, setFormScheduleMode] = useState<'all_days' | 'workdays' | 'holidays' | 'custom_days'>('all_days');
  const [formCustomDays, setFormCustomDays] = useState<string[]>([]);
  const [formHours, setFormHours] = useState<string[]>([]);
  const [formMonthlyDay, setFormMonthlyDay] = useState('1');
  const [formHandoverSop, setFormHandoverSop] = useState('');
  const [formHandoverImage, setFormHandoverImage] = useState('');
  const [formSopSteps, setFormSopSteps] = useState<SopStep[]>([]);

  // Calendar & History State
  const [selectedDateStr, setSelectedDateStr] = useState<string>('');
  const [calendarMonth, setCalendarMonth] = useState<number>(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState<number>(new Date().getFullYear());
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterType>('all');

  // Interactive UI States
  const [expandedHours, setExpandedHours] = useState<Record<number, boolean>>({});
  const [editingNoteTaskId, setEditingNoteTaskId] = useState<string | null>(null);
  const [noteValues, setNoteValues] = useState<Record<string, string>>({});
  const [noteImage, setNoteImage] = useState<Record<string, string>>({}); // Mapping noteKey -> base64 string
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  // Shortnotes/Noted State
  const [shortnotes, setShortnotes] = useState<Shortnote[]>([]);
  const [deletingShortnoteId, setDeletingShortnoteId] = useState<string | null>(null);
  const [selectedTaskIdForNote, setSelectedTaskIdForNote] = useState<string>('');
  const [newSubtaskTexts, setNewSubtaskTexts] = useState<Record<string, string>>({});
  const [focusedMemoContent, setFocusedMemoContent] = useState<{ title: string; content: string } | null>(null);
  const [showCreateMemoModal, setShowCreateMemoModal] = useState(false);
  const [memoImage, setMemoImage] = useState(''); // Memo creation attached image base64

  // Handover / SOP modal states
  const [activeHandoverTask, setActiveHandoverTask] = useState<{ task: Task; hourStr?: string } | null>(null);
  const [handoverSkipNote, setHandoverSkipNote] = useState('');
  // SOP step progress checkboxes (in-session only, resets when modal closes)
  const [sopStepCheckedByTask, setSopStepCheckedByTask] = useState<Record<string, Record<number, boolean>>>({});

  // Fullscreen Image Lightbox State
  const [focusedImageModal, setFocusedImageModal] = useState<string | null>(null);
  // Lightbox navigation: list of images in current context and current index
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);
  // Zoom/pan state for lightbox
  const [lbZoom, setLbZoom] = useState(1);
  const [lbPan, setLbPan] = useState({ x: 0, y: 0 });
  const lbDragRef = useRef<{ dragging: boolean; startX: number; startY: number; panX: number; panY: number }>({ dragging: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const lbPinchRef = useRef<{ active: boolean; startDist: number; startZoom: number }>({ active: false, startDist: 0, startZoom: 1 });

  // Q&A System State
  interface QaItem {
    id: string;
    question: string;
    answer: string;
    category: string; // 'handover' | 'system' | 'task' | 'other'
    linkedTaskId?: string; // links this Q&A to a specific task in the library
    createdAt: string;
  }
  const [qas, setQas] = useState<QaItem[]>([]);
  const [qaSearchQuery, setQaSearchQuery] = useState('');
  const [selectedQaCategory, setSelectedQaCategory] = useState<string>('all');
  const [expandedQaId, setExpandedQaId] = useState<string | null>(null);
  const [showAddQaForm, setShowAddQaForm] = useState(false);
  const [newQaQuestion, setNewQaQuestion] = useState('');
  const [newQaAnswer, setNewQaAnswer] = useState('');
  const [newQaCategory, setNewQaCategory] = useState<string>('handover');
  const [newQaLinkedTaskId, setNewQaLinkedTaskId] = useState<string>('');

  // Phase 3 additions
  const [taskLibrarySearch, setTaskLibrarySearch] = useState('');      // 3A: search
  const [collapsedSopSteps, setCollapsedSopSteps] = useState<Record<string, boolean>>({}); // 3B: collapse
  const [isSaving, setIsSaving] = useState(false);                     // 3D: loading state

  // --- Phase 3C: Export / Import JSON Backup ---
  const handleExportData = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks,
      logs,
      shortnotes,
      qas,
      workdays
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mbd-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!data.tasks || !Array.isArray(data.tasks)) {
          alert('ไฟล์ไม่ถูกต้อง — ต้องเป็น backup ที่ export จากระบบนี้เท่านั้น');
          return;
        }
        if (!window.confirm(`นำเข้าข้อมูลจากไฟล์ backup วันที่ ${data.exportedAt ? new Date(data.exportedAt).toLocaleDateString('th-TH') : 'ไม่ระบุ'}\n\nข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด ต้องการดำเนินการต่อหรือไม่?`)) return;

        if (data.tasks)   { setTasks(data.tasks); await db.upsertTasks(data.tasks.map((t: any, i: number) => ({ id: t.id, name: t.name, type: t.type, timing: t.timing ?? [], active: t.active, schedule_mode: t.scheduleMode ?? 'all_days', custom_days: t.customDays ?? [], handover_sop: t.handoverSop ?? '', handover_image: t.handoverImage ?? '', sop_steps: t.sopSteps ?? [], sort_order: i }))); }
        if (data.shortnotes) { setShortnotes(data.shortnotes); await db.upsertShortnotes(data.shortnotes.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); }
        if (data.qas)     { setQas(data.qas); for (const q of data.qas) await db.upsertQaItem({ id: q.id, question: q.question, answer: q.answer, category: q.category }); }
        if (data.workdays){ setWorkdays(data.workdays); await db.saveUserSettings({ workdays: data.workdays }); }

        alert('นำเข้าข้อมูลสำเร็จ!');
      } catch {
        alert('ไม่สามารถอ่านไฟล์ได้ — กรุณาตรวจสอบว่าเป็นไฟล์ JSON ที่ถูกต้อง');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAddQa = async (question: string, answer: string, category: string, linkedTaskId?: string) => {
    if (!question.trim() || !answer.trim()) return;
    const newItem: QaItem = { id: 'qa_' + Date.now(), question: question.trim(), answer: answer.trim(), category, linkedTaskId: linkedTaskId || undefined, createdAt: new Date().toISOString() };
    const updated = [newItem, ...qas];
    setQas(updated);
    setNewQaQuestion(''); setNewQaAnswer(''); setShowAddQaForm(false); setNewQaLinkedTaskId('');
    // Persist linkedTaskId by encoding it into category as "linked:{taskId}" — db has no separate column for it
    const persistCategory = linkedTaskId ? `linked:${linkedTaskId}` : category;
    try { await db.upsertQaItem({ id: newItem.id, question: newItem.question, answer: newItem.answer, category: persistCategory as any }); }
    catch (err) { console.error('addQa:', err); }
  };

  // Open lightbox with a list of images (for prev/next nav) or a single image
  const openLightbox = (images: string[], startIndex: number = 0) => {
    if (!images || images.length === 0) return;
    setLightboxImages(images);
    setLightboxIndex(startIndex);
    setFocusedImageModal(images[startIndex]);
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
  };

  const lightboxNav = (dir: 1 | -1) => {
    const next = lightboxIndex + dir;
    if (next < 0 || next >= lightboxImages.length) return;
    setLightboxIndex(next);
    setFocusedImageModal(lightboxImages[next]);
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
  };

  const closeLightbox = () => {
    setFocusedImageModal(null);
    setLightboxImages([]);
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
  };

  const lbZoomIn = () => setLbZoom(z => Math.min(z + 0.5, 5));
  const lbZoomOut = () => setLbZoom(z => {
    const next = Math.max(z - 0.5, 1);
    if (next === 1) setLbPan({ x: 0, y: 0 });
    return next;
  });
  const lbZoomReset = () => { setLbZoom(1); setLbPan({ x: 0, y: 0 }); };

  // Mouse drag-to-pan (desktop)
  const lbHandleMouseDown = (e: React.MouseEvent) => {
    if (lbZoom <= 1) return;
    lbDragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, panX: lbPan.x, panY: lbPan.y };
  };
  const lbHandleMouseMove = (e: React.MouseEvent) => {
    if (!lbDragRef.current.dragging) return;
    const dx = e.clientX - lbDragRef.current.startX;
    const dy = e.clientY - lbDragRef.current.startY;
    setLbPan({ x: lbDragRef.current.panX + dx, y: lbDragRef.current.panY + dy });
  };
  const lbHandleMouseUp = () => { lbDragRef.current.dragging = false; };

  // Wheel zoom (desktop)
  const lbHandleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setLbZoom(z => {
      const next = Math.min(Math.max(z + delta, 1), 5);
      if (next === 1) setLbPan({ x: 0, y: 0 });
      return next;
    });
  };

  // Touch pinch-to-zoom + drag pan (mobile)
  const lbTouchDist = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const lbHandleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      lbPinchRef.current = { active: true, startDist: lbTouchDist(e.touches), startZoom: lbZoom };
    } else if (e.touches.length === 1 && lbZoom > 1) {
      lbDragRef.current = { dragging: true, startX: e.touches[0].clientX, startY: e.touches[0].clientY, panX: lbPan.x, panY: lbPan.y };
    }
  };
  const lbHandleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lbPinchRef.current.active) {
      e.preventDefault();
      const newDist = lbTouchDist(e.touches);
      const ratio = newDist / lbPinchRef.current.startDist;
      const next = Math.min(Math.max(lbPinchRef.current.startZoom * ratio, 1), 5);
      setLbZoom(next);
      if (next === 1) setLbPan({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && lbDragRef.current.dragging) {
      const dx = e.touches[0].clientX - lbDragRef.current.startX;
      const dy = e.touches[0].clientY - lbDragRef.current.startY;
      setLbPan({ x: lbDragRef.current.panX + dx, y: lbDragRef.current.panY + dy });
    }
  };
  const lbHandleTouchEnd = () => {
    lbPinchRef.current.active = false;
    lbDragRef.current.dragging = false;
  };

  const handleDeleteQa = async (id: string) => {
    if (!window.confirm('คุณต้องการลบคำถาม Q&A นี้ใช่หรือไม่?')) return;
    const updated = qas.filter(q => q.id !== id);
    setQas(updated);
    if (expandedQaId === id) setExpandedQaId(null);
    try { await db.deleteQaItem(id); } catch (err) { console.error('deleteQa:', err); }
  };

  const hourListRef = useRef<HTMLDivElement>(null);
  const todayStr = currentTime.toISOString().split('T')[0];

  // --- INITIAL DATA LOAD FROM SUPABASE ---
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        setDbLoading(true);
        setDbError(null);

        // One-time migration from localStorage → Supabase
        const alreadyMigrated = localStorage.getItem('mbd_migrated_to_supabase');
        if (!alreadyMigrated && localStorage.getItem('mbd_tasks')) {
          await db.migrateFromLocalStorage();
        }

        // Load all data from Supabase in parallel
        const [dbTasks, dbSettings, dbShortnotes, dbQas, allLogs] = await Promise.all([
          db.getTasks(),
          db.getUserSettings(),
          db.getShortnotes(),
          db.getQaItems(),
          db.getLogsByDate(new Date().toISOString().split('T')[0], 90),
        ]);
        if (cancelled) return;

        // Map DB tasks → App Task shape
        const today = new Date().toISOString().split('T')[0];
        const mappedTasks: Task[] = dbTasks.length > 0
          ? dbTasks.map((t: any) => ({
              id:            t.id,
              name:          t.name,
              type:          t.type,
              timing:        t.timing ?? [],
              active:        t.active,
              scheduleMode:  t.schedule_mode,
              customDays:    t.custom_days ?? [],
              handoverSop:   t.handover_sop ?? '',
              handoverImage: t.handover_image ?? '',
              sopSteps:      (t.sop_steps ?? []).map((s: any) => ({
                ...s,
                images: s.images ?? (s.image ? [s.image] : []),
                image: undefined,
              })),
            }))
          : INITIAL_TASKS;
        setTasks(mappedTasks);
        setWorkdays(dbSettings.workdays);

        // Map DB logs → Record<dateKey, LogItem[]>
        const logsMap: Record<string, LogItem[]> = {};
        for (const l of allLogs) {
          const key = l.log_date;
          if (!logsMap[key]) logsMap[key] = [];
          logsMap[key].push({
            taskId:     l.task_id,
            timeSlot:   l.time_slot ?? undefined,
            actualTime: l.actual_time,
            status:     l.status,
            note:       l.note,
            notes:      (l.notes ?? []) as TaskNote[],
          });
        }
        if (!logsMap[today]) logsMap[today] = [];
        setLogs(logsMap);
        setSelectedDateStr(today);

        // Map DB shortnotes → Shortnote shape + auto-archive
        const mappedNotes: Shortnote[] = dbShortnotes.map((n: any) => {
          const nDate = n.note_date ?? today;
          let archived = n.archived ?? false;
          if (n.done && nDate !== today) archived = true;
          if (n.deleted) archived = true;
          return {
            id:           n.id,
            text:         n.text,
            done:         n.done,
            createdAt:    new Date().toISOString(),
            pinned:       n.pinned,
            linkedTaskId: n.linked_task_id,
            subtasks:     n.subtasks ?? [],
            date:         nDate,
            archived,
            deleted:      n.deleted,
            image:        n.image,
          };
        });
        setShortnotes(mappedNotes);

        // Map QA items — linkedTaskId is encoded as category="task:{taskId}" for DB persistence
        const mappedQas: QaItem[] = dbQas.length > 0
          ? dbQas.map((q: any) => {
              const rawCat = q.category as string;
              if (rawCat && rawCat.startsWith('linked:')) {
                const taskId = rawCat.slice(7);
                return { id: q.id, question: q.question, answer: q.answer, category: 'task', linkedTaskId: taskId, createdAt: new Date().toISOString() };
              }
              return { id: q.id, question: q.question, answer: q.answer, category: rawCat, createdAt: new Date().toISOString() };
            })
          : DEFAULT_QA_ITEMS;
        setQas(mappedQas);

        // Seed initial data on first run
        if (dbTasks.length === 0) {
          await db.upsertTasks(INITIAL_TASKS.map((t, i) => ({
            id: t.id, name: t.name, type: t.type, timing: t.timing,
            active: t.active, schedule_mode: t.scheduleMode, custom_days: t.customDays,
            handover_sop: t.handoverSop ?? '', handover_image: '', sop_steps: [], sort_order: i,
          })));
        }
        if (dbQas.length === 0) {
          for (const qa of DEFAULT_QA_ITEMS) {
            await db.upsertQaItem({ id: qa.id, question: qa.question, answer: qa.answer, category: qa.category as any });
          }
        }

      } catch (err: any) {
        if (!cancelled) setDbError(err?.message ?? 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        if (!cancelled) setDbLoading(false);
      }
    };

    loadData();
    setExpandedHours({ [new Date().getHours()]: true });
    const interval = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [userId]);

  // Save tasks + logs to Supabase (and keep local state in sync)
  const saveState = useCallback(async (updatedTasks: Task[], updatedLogs: Record<string, LogItem[]>) => {
    setTasks(updatedTasks);
    setLogs(updatedLogs);
    try {
      await db.upsertTasks(updatedTasks.map((t, i) => ({
        id: t.id, name: t.name, type: t.type, timing: t.timing,
        active: t.active, schedule_mode: t.scheduleMode, custom_days: t.customDays,
        handover_sop: t.handoverSop ?? '', handover_image: t.handoverImage ?? '',
        sop_steps: t.sopSteps ?? [], sort_order: i,
      })));
      // Save only today's logs
      const today = new Date().toISOString().split('T')[0];
      const todayLogs = updatedLogs[today] ?? [];
      await db.upsertLogs(todayLogs.map(l => ({
        task_id: l.taskId, log_date: today,
        time_slot: l.timeSlot ?? null, actual_time: l.actualTime,
        status: l.status, note: l.note, notes: l.notes ?? [],
      })));
    } catch (err) {
      console.error('saveState error:', err);
    }
  }, []);

  const handleSetWorkdays = async (newWorkdays: string[]) => {
    setWorkdays(newWorkdays);
    try {
      await db.saveUserSettings({ workdays: newWorkdays });
    } catch (err) {
      console.error('saveWorkdays error:', err);
    }
  };

  // Helper to find the day number of the first workday of a given month
  const getFirstWorkdayOfMonth = (year: number, month: number, workdaysList: string[]): number => {
    // A workday is guaranteed to occur in the first 15 days of the month
    for (let d = 1; d <= 15; d++) {
      const tempDate = new Date(year, month, d);
      const dayName = DAY_NAMES[tempDate.getDay()];
      if (workdaysList.includes(dayName)) {
        return d;
      }
    }
    return 1; // Fallback
  };

  const isFirstWorkdayOfMonth = (date: Date, workdaysList: string[]): boolean => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstWorkdayDayNum = getFirstWorkdayOfMonth(year, month, workdaysList);
    return date.getDate() === firstWorkdayDayNum;
  };

  // --- BUSINESS LOGIC ---

  // Check if a task is scheduled for a specific date
  const isTaskScheduledForDate = (task: Task, dateObj: Date): boolean => {
    if (!task.active) return false;
    
    const dayOfWeekStr = DAY_NAMES[dateObj.getDay()]; // 'Sun', 'Mon', ...
    const isWorkday = workdays.includes(dayOfWeekStr);
    const isWeekend = !isWorkday;
    
    const scheduleMode = task.scheduleMode || 'all_days';
    
    // 1. Workday/Holiday schedule logic
    if (scheduleMode === 'workdays' && !isWorkday) return false;
    if (scheduleMode === 'holidays' && !isWeekend) return false;
    
    if (scheduleMode === 'custom_days') {
      const daysToCheck = task.customDays && task.customDays.length > 0 ? task.customDays : task.timing;
      if (!daysToCheck.includes(dayOfWeekStr)) return false;
    }
    
    // 2. Monthly specific logic
    if (task.type === 'monthly') {
      if (task.timing.includes('first_workday')) {
        if (!isFirstWorkdayOfMonth(dateObj, workdays)) return false;
      } else {
        const dateNumStr = dateObj.getDate().toString();
        if (!task.timing.includes(dateNumStr)) return false;
      }
    }
    
    return true;
  };

  // Get status of a task for selected day and optional timeSlot
  const getTaskStatus = (taskId: string, dateKey: string = todayStr, timeSlot?: string): 'done' | 'skipped' | 'pending' => {
    const dayLogs = logs[dateKey] || [];
    const log = dayLogs.find(l => l.taskId === taskId && (timeSlot === undefined ? !l.timeSlot : l.timeSlot === timeSlot));
    return log ? log.status : 'pending';
  };

  // Toggle or Set Task Status with optional timeSlot
  const handleUpdateTaskStatus = (taskId: string, status: 'done' | 'skipped' | 'pending', timeSlot?: string, noteText?: string) => {
    const dateKey = todayStr;
    const currentDayLogs = logs[dateKey] ? [...logs[dateKey]] : [];
    const logIndex = currentDayLogs.findIndex(l => l.taskId === taskId && (timeSlot === undefined ? !l.timeSlot : l.timeSlot === timeSlot));

    const actualTimeStr = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (logIndex > -1) {
      if (status === 'pending') {
        currentDayLogs.splice(logIndex, 1);
      } else {
        currentDayLogs[logIndex] = {
          ...currentDayLogs[logIndex],
          status,
          actualTime: actualTimeStr,
          note: noteText !== undefined ? noteText : currentDayLogs[logIndex].note
        };
      }
    } else {
      if (status !== 'pending') {
        currentDayLogs.push({
          taskId,
          timeSlot,
          actualTime: actualTimeStr,
          status,
          note: noteText || ''
        });
      }
    }

    const updatedLogs = {
      ...logs,
      [dateKey]: currentDayLogs
    };

    saveState(tasks, updatedLogs);
  };

  // Save or Update Note Text with optional timeSlot
  const handleSaveNote = (taskId: string, noteText: string, timeSlot?: string) => {
    const dateKey = todayStr;
    const currentDayLogs = logs[dateKey] ? [...logs[dateKey]] : [];
    const logIndex = currentDayLogs.findIndex(l => l.taskId === taskId && (timeSlot === undefined ? !l.timeSlot : l.timeSlot === timeSlot));

    if (logIndex > -1) {
      currentDayLogs[logIndex] = {
        ...currentDayLogs[logIndex],
        note: noteText
      };
    } else {
      currentDayLogs.push({
        taskId,
        timeSlot,
        actualTime: currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'pending',
        note: noteText
      });
    }

    const updatedLogs = {
      ...logs,
      [dateKey]: currentDayLogs
    };

    saveState(tasks, updatedLogs);
  };

  // Add multiple task-specific notes
  const handleAddTaskNote = (taskId: string, noteText: string, timeSlot?: string, imageBase64?: string) => {
    if (!noteText.trim()) return;
    const dateKey = todayStr;
    const currentDayLogs = logs[dateKey] ? [...logs[dateKey]] : [];
    const logIndex = currentDayLogs.findIndex(l => l.taskId === taskId && (timeSlot === undefined ? !l.timeSlot : l.timeSlot === timeSlot));

    const newNote: TaskNote = {
      id: 'tn_' + Date.now() + Math.random().toString(36).substring(2, 5),
      text: noteText.trim(),
      done: false,
      createdAt: currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      image: imageBase64
    };

    if (logIndex > -1) {
      const existing = currentDayLogs[logIndex];
      const notesList = existing.notes ? [...existing.notes] : [];
      // If there was a legacy note, let's migrate it too!
      if (existing.note && existing.note.trim() !== '' && existing.note !== '-' && notesList.length === 0) {
        notesList.push({
          id: 'tn_legacy',
          text: existing.note,
          done: false,
          createdAt: existing.actualTime || '09:00'
        });
      }

      currentDayLogs[logIndex] = {
        ...existing,
        note: '', // Clear legacy note as we migrated to list
        notes: [...notesList, newNote]
      };
    } else {
      currentDayLogs.push({
        taskId,
        timeSlot,
        actualTime: currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'pending',
        note: '',
        notes: [newNote]
      });
    }

    const updatedLogs = {
      ...logs,
      [dateKey]: currentDayLogs
    };
    saveState(tasks, updatedLogs);
  };

  // Toggle a task's note done state
  const handleToggleTaskNote = (taskId: string, noteId: string, timeSlot?: string) => {
    const dateKey = todayStr;
    const currentDayLogs = logs[dateKey] ? [...logs[dateKey]] : [];
    const logIndex = currentDayLogs.findIndex(l => l.taskId === taskId && (timeSlot === undefined ? !l.timeSlot : l.timeSlot === timeSlot));

    if (logIndex > -1) {
      const existing = currentDayLogs[logIndex];
      const notesList = existing.notes ? existing.notes.map(n => {
        if (n.id === noteId) {
          return { ...n, done: !n.done };
        }
        return n;
      }) : [];

      currentDayLogs[logIndex] = {
        ...existing,
        notes: notesList
      };

      const updatedLogs = {
        ...logs,
        [dateKey]: currentDayLogs
      };
      saveState(tasks, updatedLogs);
    }
  };

  // Delete a task's note
  const handleDeleteTaskNote = (taskId: string, noteId: string, timeSlot?: string) => {
    const dateKey = todayStr;
    const currentDayLogs = logs[dateKey] ? [...logs[dateKey]] : [];
    const logIndex = currentDayLogs.findIndex(l => l.taskId === taskId && (timeSlot === undefined ? !l.timeSlot : l.timeSlot === timeSlot));

    if (logIndex > -1) {
      const existing = currentDayLogs[logIndex];
      const notesList = existing.notes ? existing.notes.filter(n => n.id !== noteId) : [];

      currentDayLogs[logIndex] = {
        ...existing,
        notes: notesList
      };

      const updatedLogs = {
        ...logs,
        [dateKey]: currentDayLogs
      };
      saveState(tasks, updatedLogs);
    }
  };

  // Add Shortnote handler
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddText.trim()) return;

    const newNote: Shortnote = {
      id: 'sn_' + Date.now(),
      text: quickAddText.trim(),
      done: false,
      pinned: false,
      linkedTaskId: selectedTaskIdForNote || undefined,
      createdAt: new Date().toISOString(),
      date: todayStr,
      archived: false,
      deleted: false,
      image: memoImage || undefined
    };

    const updated = [newNote, ...shortnotes];
    setShortnotes(updated);
    try { await db.upsertShortnotes(updated.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); } catch(e) { console.error('shortnote save:', e); }
    setQuickAddText('');
    setSelectedTaskIdForNote('');
    setMemoImage('');
    setShowCreateMemoModal(false);
  };

  const handleToggleShortnote = async (id: string) => {
    const updated = shortnotes.map(n => {
      if (n.id === id) {
        return { ...n, done: !n.done };
      }
      return n;
    });
    setShortnotes(updated);
    try { await db.upsertShortnotes(updated.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); } catch(e) { console.error('shortnote save:', e); }
  };

  const handleTogglePinShortnote = async (id: string) => {
    const updated = shortnotes.map(n => {
      if (n.id === id) {
        return { ...n, pinned: !n.pinned };
      }
      return n;
    });
    setShortnotes(updated);
    try { await db.upsertShortnotes(updated.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); } catch(e) { console.error('shortnote save:', e); }
  };

  const handleDeleteShortnote = async (id: string) => {
    setDeletingShortnoteId(id);
  };

  const confirmDeleteShortnote = async () => {
    if (!deletingShortnoteId) return;
    // Mark as deleted & archived instead of completely discarding so we show in history!
    const updated = shortnotes.map(n => {
      if (n.id === deletingShortnoteId) {
        return { ...n, deleted: true, archived: true };
      }
      return n;
    });
    setShortnotes(updated);
    try { await db.upsertShortnotes(updated.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); } catch(e) { console.error('shortnote save:', e); }
    setDeletingShortnoteId(null);
  };

  const handleArchiveCompletedShortnotes = async () => {
    const updated = shortnotes.map(n => {
      if (n.done) {
        return { ...n, archived: true };
      }
      return n;
    });
    setShortnotes(updated);
    try { await db.upsertShortnotes(updated.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); } catch(e) { console.error('shortnote save:', e); }
  };

  const handleAddShortnoteSubtask = async (noteId: string, text: string) => {
    if (!text.trim()) return;
    const updated = shortnotes.map(n => {
      if (n.id === noteId) {
        const subtasks = n.subtasks || [];
        const newSub: ShortnoteSubtask = {
          id: 'sub_' + Date.now() + Math.random().toString(36).substring(2, 7),
          text: text.trim(),
          done: false
        };
        return { ...n, subtasks: [...subtasks, newSub] };
      }
      return n;
    });
    setShortnotes(updated);
    try { await db.upsertShortnotes(updated.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); } catch(e) { console.error('shortnote save:', e); }
  };

  const handleToggleShortnoteSubtask = async (noteId: string, subtaskId: string) => {
    const updated = shortnotes.map(n => {
      if (n.id === noteId) {
        const subtasks = (n.subtasks || []).map(s => {
          if (s.id === subtaskId) {
            return { ...s, done: !s.done };
          }
          return s;
        });
        return { ...n, subtasks };
      }
      return n;
    });
    setShortnotes(updated);
    try { await db.upsertShortnotes(updated.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); } catch(e) { console.error('shortnote save:', e); }
  };

  const handleDeleteShortnoteSubtask = async (noteId: string, subtaskId: string) => {
    const updated = shortnotes.map(n => {
      if (n.id === noteId) {
        const subtasks = (n.subtasks || []).filter(s => s.id !== subtaskId);
        return { ...n, subtasks };
      }
      return n;
    });
    setShortnotes(updated);
    try { await db.upsertShortnotes(updated.map((n: any) => ({ id: n.id, text: n.text, done: n.done, pinned: n.pinned ?? false, archived: n.archived ?? false, deleted: n.deleted ?? false, linked_task_id: n.linkedTaskId, subtasks: n.subtasks ?? [], image: n.image, note_date: n.date }))); } catch(e) { console.error('shortnote save:', e); }
  };

  // --- FORM MANAGEMENT HANDLERS ---
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setIsSaving(true);

    let timing: string[] = [];
    if (formType === 'hourly') {
      timing = formHours;
    } else if (formType === 'monthly') {
      timing = [formMonthlyDay];
    }

    let updatedTasks = [...tasks];
    if (editingTaskId) {
      updatedTasks = tasks.map(t => {
        if (t.id === editingTaskId) {
          return { 
            ...t, 
            name: formName.trim(), 
            type: formType, 
            timing, 
            scheduleMode: formScheduleMode, 
            customDays: formScheduleMode === 'custom_days' ? formCustomDays : [],
            handoverSop: formHandoverSop.trim(),
            handoverImage: formHandoverImage,
            sopSteps: formSopSteps
          };
        }
        return t;
      });
    } else {
      const newTask: Task = {
        id: 't_' + Date.now(),
        name: formName.trim(),
        type: formType,
        timing,
        active: true,
        scheduleMode: formScheduleMode,
        customDays: formScheduleMode === 'custom_days' ? formCustomDays : [],
        handoverSop: formHandoverSop.trim(),
        handoverImage: formHandoverImage,
        sopSteps: formSopSteps
      };
      updatedTasks.push(newTask);
    }

    saveState(updatedTasks, logs);
    setTimeout(() => setIsSaving(false), 400);
    resetForm();
  };

  const startEditTask = (task: Task) => {
    setEditingTaskId(task.id);
    setFormName(task.name);
    setFormType(task.type);
    setFormScheduleMode(task.scheduleMode || 'all_days');
    setFormCustomDays(task.customDays || []);
    setFormHandoverSop(task.handoverSop || '');
    setFormHandoverImage(task.handoverImage || '');
    setFormSopSteps(task.sopSteps || []);
    
    if (task.type === 'hourly') {
      setFormHours(task.timing);
      setFormMonthlyDay('1');
    } else if (task.type === 'monthly') {
      setFormHours([]);
      setFormMonthlyDay(task.timing[0] || '1');
    } else {
      setFormHours([]);
      setFormMonthlyDay('1');
    }
  };

  const toggleTaskActive = (taskId: string) => {
    const updatedTasks = tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, active: !t.active };
      }
      return t;
    });
    saveState(updatedTasks, logs);
  };

  const handleDeleteTask = (taskId: string) => {
    setDeletingTaskId(taskId);
  };

  const confirmDeleteTask = () => {
    if (!deletingTaskId) return;
    const updatedTasks = tasks.filter(t => t.id !== deletingTaskId);
    saveState(updatedTasks, logs);
    if (editingTaskId === deletingTaskId) {
      resetForm();
    }
    setDeletingTaskId(null);
  };

  const resetForm = () => {
    setEditingTaskId(null);
    setFormName('');
    setFormType('hourly');
    setFormScheduleMode('all_days');
    setFormCustomDays([]);
    setFormHours([]);
    setFormMonthlyDay('1');
    setFormHandoverSop('');
    setFormHandoverImage('');
    setFormSopSteps([]);
  };

  const toggleFormHour = (hour: string) => {
    if (formHours.includes(hour)) {
      setFormHours(formHours.filter(h => h !== hour));
    } else {
      setFormHours([...formHours, hour]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size — warn if > 5MB (Supabase Storage handles larger files fine)
    const MAX_SIZE_MB = 5;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      alert(`ขนาดไฟล์รูปภาพใหญ่เกินไป (${(file.size / 1024 / 1024).toFixed(1)} MB)\nกรุณาใช้รูปที่มีขนาดไม่เกิน ${MAX_SIZE_MB} MB เพื่อป้องกันปัญหาการบันทึก`);
      e.target.value = '';
      return;
    }

    // Compress image to max 1200px wide before storing as base64
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const MAX_DIM = 1600;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.82);
        callback(compressed);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Fallback: read as-is
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          callback(reader.result);
        }
      };
      reader.readAsDataURL(file);
    };
    img.src = objectUrl;
    // Reset input so same file can be uploaded again
    e.target.value = '';
  };

  // --- CALENDAR LOGIC ---
  const changeMonth = (step: number) => {
    let newMonth = calendarMonth + step;
    let newYear = calendarYear;
    if (newMonth > 11) {
      newMonth = 0;
      newYear += 1;
    } else if (newMonth < 0) {
      newMonth = 11;
      newYear -= 1;
    }
    setCalendarMonth(newMonth);
    setCalendarYear(newYear);
  };

  const getExpectedTasksForDate = (dateObj: Date): Task[] => {
    return tasks.filter(t => isTaskScheduledForDate(t, dateObj));
  };

  const generateCalendarDays = () => {
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const totalDays = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const days = [];

    for (let i = 0; i < firstDayIndex; i++) {
      days.push({ dayNum: null, dateStr: '' });
    }

    const todayCompareStr = new Date().toISOString().split('T')[0];

    for (let d = 1; d <= totalDays; d++) {
      const dateObj = new Date(calendarYear, calendarMonth, d);
      const dateStr = `${dateObj.getFullYear()}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-${dateObj.getDate().toString().padStart(2, '0')}`;
      
      let statusColor = 'text-[#121212] hover:bg-black/5';

      if (dateStr <= todayCompareStr) {
        const expected = getExpectedTasksForDate(dateObj);
        const dayLogs = logs[dateStr] || [];

        if (expected.length > 0) {
          let doneCount = 0;
          let skippedCount = 0;
          let overdueCount = 0;
          let totalItemsCount = 0;

          expected.forEach(t => {
            if (t.type === 'hourly') {
              t.timing.forEach(slot => {
                totalItemsCount++;
                const l = dayLogs.find(x => x.taskId === t.id && x.timeSlot === slot);
                if (!l || l.status === 'pending') {
                  overdueCount++;
                } else if (l.status === 'done') {
                  doneCount++;
                } else if (l.status === 'skipped') {
                  skippedCount++;
                }
              });
            } else {
              totalItemsCount++;
              const l = dayLogs.find(x => x.taskId === t.id && !x.timeSlot);
              if (!l || l.status === 'pending') {
                overdueCount++;
              } else if (l.status === 'done') {
                doneCount++;
              } else if (l.status === 'skipped') {
                skippedCount++;
              }
            }
          });

          if (overdueCount > 0) {
            statusColor = 'text-red-600 bg-red-50 hover:bg-red-100 border border-red-200/50';
          } else if (skippedCount > 0 && doneCount === 0) {
            statusColor = 'text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200/50';
          } else if (doneCount === totalItemsCount) {
            statusColor = 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/30';
          } else {
            statusColor = 'text-emerald-600 bg-emerald-50/50 hover:bg-emerald-100 border border-emerald-200/20';
          }
        }
      }

      days.push({ dayNum: d, dateStr, statusColor });
    }

    return days;
  };

  // --- DYNAMIC DASHBOARD GETTERS (UNIFIED ROUTINES) ---

  // Get active daily & monthly routines scheduled for today
  const getTodayActiveRoutines = (): Task[] => {
    return tasks.filter(t => {
      if (t.type === 'hourly') return false; // Hourly displayed on left timeline
      return isTaskScheduledForDate(t, currentTime);
    });
  };

  // Filter routines based on dashboard choice ('all' | 'daily' | 'monthly')
  const getFilteredTodayRoutines = (): Task[] => {
    const todayRoutines = getTodayActiveRoutines();
    if (dashboardRoutineFilter === 'all') return todayRoutines;
    return todayRoutines.filter(t => t.type === dashboardRoutineFilter);
  };

  const getProgressStats = () => {
    let totalItems = 0;
    let doneItems = 0;

    // 1. Hourly tasks scheduled for today
    const hourlyTasks = tasks.filter(t => t.active && t.type === 'hourly' && isTaskScheduledForDate(t, currentTime));
    hourlyTasks.forEach(t => {
      t.timing.forEach(slot => {
        totalItems++;
        if (getTaskStatus(t.id, todayStr, slot) === 'done') {
          doneItems++;
        }
      });
    });

    // 2. Daily & Monthly routines scheduled for today
    const routines = tasks.filter(t => t.active && t.type !== 'hourly' && isTaskScheduledForDate(t, currentTime));
    routines.forEach(t => {
      totalItems++;
      if (getTaskStatus(t.id, todayStr) === 'done') {
        doneItems++;
      }
    });

    if (totalItems === 0) return { percent: 0, done: 0, total: 0 };

    return {
      percent: Math.round((doneItems / totalItems) * 100),
      done: doneItems,
      total: totalItems
    };
  };

  const progressStats = getProgressStats();

  const getTimeIndicatorOffset = () => {
    const now = currentTime;
    const currentHour = now.getHours();
    const minutes = now.getMinutes();

    const block = document.getElementById(`hour-block-${currentHour}`);
    if (block && hourListRef.current) {
      const topOffset = block.offsetTop;
      const height = block.clientHeight;
      return topOffset + 12 + ((height - 24) * (minutes / 60));
    }
    return null;
  };

  const indicatorTop = getTimeIndicatorOffset();

  const navigateTo = (view: ViewType) => {
    setCurrentView(view);
  };

  const handleSignOut = async () => {
    if (!window.confirm('ต้องการออกจากระบบใช่หรือไม่?')) return;
    await supabase.auth.signOut();
  };

  if (dbLoading) {
    return (
      <div className="min-h-screen bg-[#F9F9F7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center font-black italic text-xl">R.L</div>
          <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" />
          <p className="text-xs text-black/40 font-mono uppercase tracking-widest">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="min-h-screen bg-[#F9F9F7] flex items-center justify-center p-4">
        <div className="bg-white border border-red-200 rounded-2xl p-8 max-w-sm w-full text-center shadow-sm">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="font-black text-lg text-[#121212] mb-2">โหลดข้อมูลไม่สำเร็จ</h2>
          <p className="text-xs text-black/50 mb-6 font-mono">{dbError}</p>
          <button onClick={() => window.location.reload()} className="bg-black text-white px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer">รีโหลดหน้าใหม่</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F9F7] text-[#121212] flex flex-row overflow-hidden font-sans selection:bg-black selection:text-[#F9F9F7]">
      
      {/* ======================================================= */}
      {/* SIDEBAR RAIL                                            */}
      {/* ======================================================= */}
      <aside className="w-14 sm:w-20 md:w-24 lg:w-28 border-r border-black/10 flex flex-col justify-between items-center py-4 sm:py-8 bg-[#FDFDFD] select-none shrink-0 z-40 shadow-sm transition-all duration-300">
        {/* LOGO & TITLE */}
        <div className="flex flex-col items-center text-center px-1 sm:px-2">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-black text-white rounded-lg flex items-center justify-center font-black italic text-sm sm:text-lg tracking-tighter mb-1 sm:mb-2 shadow-sm">
            R.L
          </div>
          <span className="hidden sm:block uppercase tracking-[0.2em] text-[8px] sm:text-[9px] font-black text-black/40">
            ROUTINE
          </span>
          <span className="hidden md:block uppercase tracking-[0.1em] text-[8px] font-bold text-black/30">
            SERIES
          </span>
        </div>

        {/* MAIN NAVIGATION WITH ICONS & LABELS */}
        <div className="flex flex-col items-center w-full px-1 sm:px-2.5 space-y-2 sm:space-y-3.5">
          <button 
            onClick={() => navigateTo('dashboard')}
            className={`w-full py-2 sm:py-3.5 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer border relative ${
              currentView === 'dashboard' 
                ? 'bg-black text-[#F9F9F7] border-black shadow-md scale-102' 
                : 'text-black/50 border-transparent hover:text-black hover:bg-black/[0.03]'
            }`}
            title="แผงควบคุมหลัก (Dashboard)"
          >
            {/* LINE-Style Red Notification Bubble */}
            {shortnotes.filter(n => !n.done && !n.archived && !n.deleted).length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white font-black w-4 sm:w-5.5 h-4 sm:h-5.5 rounded-full flex items-center justify-center border-2 border-[#F9F9F7] shadow-lg animate-bounce select-none text-[8px] sm:text-[10px]">
                {shortnotes.filter(n => !n.done && !n.archived && !n.deleted).length}
              </span>
            )}
            <LayoutDashboard className="w-4.5 h-4.5 sm:w-5 sm:h-5 mb-1" />
            <span className="hidden sm:block text-[9px] sm:text-[10px] font-black tracking-tight leading-none">แผงควบคุม</span>
            <span className="hidden md:block text-[8px] opacity-60 uppercase tracking-widest font-mono scale-90 mt-0.5">DASHBOARD</span>
          </button>

          <button 
            onClick={() => navigateTo('management')}
            className={`w-full py-2 sm:py-3.5 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer border ${
              currentView === 'management' 
                ? 'bg-black text-[#F9F9F7] border-black shadow-md scale-102' 
                : 'text-black/50 border-transparent hover:text-black hover:bg-black/[0.03]'
            }`}
            title="จัดแต่งรายการคลังงาน (Task Library)"
          >
            <Layers className="w-4.5 h-4.5 sm:w-5 sm:h-5 mb-1" />
            <span className="hidden sm:block text-[9px] sm:text-[10px] font-black tracking-tight leading-none">คลังภารกิจ</span>
            <span className="hidden md:block text-[8px] opacity-60 uppercase tracking-widest font-mono scale-90 mt-0.5">LIBRARY</span>
          </button>

          <button 
            onClick={() => navigateTo('history')}
            className={`w-full py-2 sm:py-3.5 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer border ${
              currentView === 'history' 
                ? 'bg-black text-[#F9F9F7] border-black shadow-md scale-102' 
                : 'text-black/50 border-transparent hover:text-black hover:bg-black/[0.03]'
            }`}
            title="ประวัติและตรวจสอบย้อนหลัง (History & Logs)"
          >
            <HistoryIcon className="w-4.5 h-4.5 sm:w-5 sm:h-5 mb-1" />
            <span className="hidden sm:block text-[9px] sm:text-[10px] font-black tracking-tight leading-none">ประวัติงาน</span>
            <span className="hidden md:block text-[8px] opacity-60 uppercase tracking-widest font-mono scale-90 mt-0.5">HISTORY</span>
          </button>

          <button 
            onClick={() => navigateTo('qa')}
            className={`w-full py-2 sm:py-3.5 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer border ${
              currentView === 'qa' 
                ? 'bg-black text-[#F9F9F7] border-black shadow-md scale-102' 
                : 'text-black/50 border-transparent hover:text-black hover:bg-black/[0.03]'
            }`}
            title="ศูนย์รวมคำถาม & วิธีทำภารกิจ (Operational Q&A)"
          >
            <HelpCircle className="w-4.5 h-4.5 sm:w-5 sm:h-5 mb-1" />
            <span className="hidden sm:block text-[9px] sm:text-[10px] font-black tracking-tight leading-none">คลัง Q&A</span>
            <span className="hidden md:block text-[8px] opacity-60 uppercase tracking-widest font-mono scale-90 mt-0.5">Q&A</span>
          </button>

          <button 
            onClick={() => setShowCreateMemoModal(true)}
            className="w-full py-2 sm:py-3.5 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer border border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:border-amber-500 relative shadow-inner group"
            title="เพิ่มบันทึกย่อ / ข้อความแจ้งเตือนด่วนดิ่งเข้าแผงความจำ (Quick Brain Dump)"
          >
            <div className="absolute -top-1 -right-1 bg-amber-500 text-white text-[7px] sm:text-[8px] font-black px-1 sm:px-1.5 py-0.5 rounded-full select-none shadow-sm animate-pulse">
              NEW
            </div>
            <Sparkles className="w-4.5 h-4.5 sm:w-5 sm:h-5 mb-1 text-amber-600 group-hover:rotate-12 transition-transform" />
            <span className="hidden sm:block text-[9px] sm:text-[10px] font-black tracking-tight leading-none text-center">โน้ตด่วน</span>
            <span className="hidden md:block text-[8px] text-amber-700/60 uppercase tracking-widest font-mono scale-90 mt-0.5">MEMO</span>
          </button>
        </div>

        {/* SETTINGS / WORKDAYS AT BOTTOM */}
        <div className="flex flex-col items-center w-full px-1 sm:px-2 space-y-4 sm:space-y-6">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`w-full py-1.5 sm:py-3 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer border ${
              showSettings 
                ? 'bg-amber-500 text-white border-amber-600 shadow-sm scale-102' 
                : 'text-black/60 border-transparent hover:text-black hover:bg-black/[0.03]'
            }`}
            title="ตั้งค่าวันทำงาน / Workdays Config"
          >
            <Settings className={`w-4 h-4 sm:w-4.5 sm:h-4.5 mb-1 ${showSettings ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
            <span className="hidden sm:block text-[8px] sm:text-[9px] font-black tracking-tight text-center leading-none">วันทำงาน ({workdays.length})</span>
          </button>

          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-emerald-500 rounded-full animate-pulse shadow-sm" />
              <span className="text-[7px] sm:text-[8px] font-mono font-black tracking-widest text-black/30">V3.0.DB</span>
            </div>
            <button
              onClick={handleSignOut}
              className="flex flex-col items-center gap-0.5 text-red-500 hover:text-white hover:bg-red-500 active:scale-95 transition-all cursor-pointer px-2 py-2 rounded-lg border border-red-200 hover:border-red-500"
              title={`ออกจากระบบ (${session.user.email})`}
            >
              <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-wider hidden sm:block">ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ======================================================= */}
      {/* MAIN LAYOUT CANVAS                                      */}
      {/* ======================================================= */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        
        {/* EDITORIAL HEADER */}
        <header className="h-16 sm:h-20 border-b border-black/10 flex items-center justify-between px-3 sm:px-6 md:px-10 shrink-0 bg-[#F9F9F7]/95 backdrop-blur-sm z-30 transition-all duration-300">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <span className="text-sm sm:text-xl font-black italic tracking-tighter">ROUTINE.LAB</span>
            <span className="hidden sm:block h-px w-6 sm:w-8 md:w-12 bg-black/30" />
            <div className="flex items-center gap-1 sm:gap-2">
              {(() => {
                const pct = progressStats.percent;
                let badgeBg = 'bg-rose-600 text-white';
                let checkColor = 'text-rose-200';
                if (pct >= 80) {
                  badgeBg = 'bg-emerald-600 text-white';
                  checkColor = 'text-emerald-200';
                } else if (pct >= 40) {
                  badgeBg = 'bg-amber-500 text-white';
                  checkColor = 'text-amber-100';
                }
                
                return (
                  <span className={`text-[9px] sm:text-[11px] uppercase tracking-wider sm:tracking-widest font-black px-2 sm:px-3 py-1 sm:py-1.5 rounded-md select-none shadow-sm flex items-center gap-1 transition-all duration-500 ${badgeBg}`}>
                    <CheckCircle2 className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${checkColor}`} />
                    <span>
                      <span className="hidden xs:inline sm:inline">PROGRESS: </span>
                      {progressStats.percent}% ({progressStats.done}/{progressStats.total})
                      <span className="hidden md:inline"> บรรลุแล้ว</span>
                    </span>
                  </span>
                );
              })()}
            </div>
          </div>

          {/* Thai Localization Clock */}
          <div className="flex flex-col items-end">
            <span className="hidden sm:block font-serif text-xs font-bold italic text-black/80">
              {currentTime.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            <span className="sm:hidden font-serif text-[10px] font-bold italic text-black/80 leading-none mb-0.5">
              {currentTime.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })}
            </span>
            <span className="font-mono text-[9px] sm:text-[10px] text-red-500 font-bold uppercase tracking-widest flex items-center gap-1 mt-0.5 sm:mt-1">
              <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3 inline-block animate-spin" style={{ animationDuration: '6s' }} />
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </header>

        {/* WORKDAYS SETTINGS DRAWER */}
        {showSettings && (
          <div className="bg-[#F3F3EF] border-b border-black/15 py-6 px-6 md:px-10 animate-fadeIn z-20 shadow-inner relative">
            <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-1">
                <h3 className="text-xs uppercase tracking-[0.25em] font-black text-black flex items-center gap-2">
                  <Settings className="w-4 h-4 text-black animate-spin" style={{ animationDuration: '10s' }} />
                  ตารางกำหนดวันทำงานสัปดาห์ (Workdays Table)
                </h3>
                <p className="text-xs text-black/50 max-w-xl leading-relaxed">
                  กดเลือกวันปกติที่คุณต้องการให้ระบบถือเป็น <strong>"วันทำงาน (Workdays)"</strong> วันที่ไม่ได้เลือกจะกลายเป็น "วันหยุด (Holidays/Days Off)" โดยอัตโนมัติ ซึ่งมีผลต่อตารางและระบบคำนวณวันทำงานวันแรกของเดือนทันที
                </p>
              </div>

              <div className="flex flex-col gap-2.5 shrink-0 bg-white/50 p-4 border border-black/5 rounded-lg">
                <span className="text-[9px] uppercase tracking-wider font-bold text-black/40">
                  คลิกเพื่อเปิด/ปิด วันทำงาน (Click days to toggle)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_NAMES.map((day, idx) => {
                    const isSelected = workdays.includes(day);
                    return (
                      <button
                        key={day}
                        onClick={() => {
                          const updated = isSelected 
                            ? workdays.filter(d => d !== day) 
                            : [...workdays, day];
                          handleSetWorkdays(updated);
                        }}
                        className={`px-3 py-2 text-xs font-bold border rounded transition-all cursor-pointer ${
                          isSelected 
                            ? 'bg-black text-white border-black shadow-sm' 
                            : 'bg-white border-black/10 text-black/50 hover:bg-black/[0.02]'
                        }`}
                      >
                        {DAY_NAMES_TH[idx]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => setShowSettings(false)}
                className="p-2 self-end md:self-center border border-black/10 hover:border-black rounded-full hover:bg-black/5 text-black cursor-pointer transition-all shrink-0 animate-fadeIn"
                title="ปิดเมนูตั้งค่า"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* CONTAINER VIEWPORTS */}
        <div className="flex-1 overflow-hidden relative">

          {/* ======================================================= */}
          {/* VIEW: DASHBOARD (UNIFIED MULTI-TIMELINE & BRAIN-DUMP)  */}
          {/* ======================================================= */}
          <div className={`absolute inset-0 grid grid-cols-1 lg:grid-cols-12 transition-all duration-300 ${currentView === 'dashboard' ? 'opacity-100 z-10' : 'opacity-0 -z-10 pointer-events-none'}`}>
            
            {/* LEFT: 24-Hour Timeline */}
            <div ref={hourListRef} className="col-span-1 lg:col-span-7 border-r border-black/10 overflow-y-auto relative py-6 px-4 md:px-8 space-y-3 bg-[#F9F9F7]">
              
              {/* Live Time Indicator */}
              {indicatorTop !== null && (
                <div 
                  className="absolute left-0 right-0 h-0.5 bg-red-500 z-10 pointer-events-none transition-all duration-500" 
                  style={{ top: `${indicatorTop}px` }}
                >
                  <div className="absolute -top-1.5 left-4 md:left-8 px-2 py-0.5 bg-red-500 text-white font-mono text-[8px] font-bold rounded uppercase tracking-wider shadow-sm">
                    {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} NOW
                  </div>
                </div>
              )}

              {Array.from({ length: 24 }).map((_, hourNum) => {
                const hourStr = hourNum.toString().padStart(2, '0') + ':00';
                
                // Fetch hourly tasks that are active TODAY
                const hourTasks = tasks.filter(t => {
                  if (t.type !== 'hourly' || !t.timing.includes(hourStr)) return false;
                  return isTaskScheduledForDate(t, currentTime);
                });
                
                const isCurrentHour = currentTime.getHours() === hourNum;
                const isPastHour = currentTime.getHours() > hourNum;
                
                let allDone = hourTasks.length > 0;
                let hasOverdue = false;
                
                hourTasks.forEach(t => {
                  const status = getTaskStatus(t.id, todayStr, hourStr);
                  if (status !== 'done' && status !== 'skipped') {
                    allDone = false;
                  }
                  if (isPastHour && status === 'pending') {
                    hasOverdue = true;
                  }
                });

                const isCollapsed = !isCurrentHour && !expandedHours[hourNum];
                const overduePulseClass = hasOverdue ? 'border-red-300 ring-2 ring-red-100 bg-red-50/40' : '';

                return (
                  <div 
                    id={`hour-block-${hourNum}`}
                    key={hourNum}
                    className={`group border rounded-lg transition-all duration-300 ${
                      isCurrentHour 
                        ? 'border-black bg-white shadow-md p-4' 
                        : isCollapsed
                          ? 'border-black/10 hover:border-black/30 bg-black/[0.01] hover:bg-black/[0.03] p-2.5 py-3 cursor-pointer'
                          : 'border-black/10 bg-white/50 p-4'
                    } ${overduePulseClass} ${allDone && isPastHour ? 'bg-emerald-50/20 border-emerald-200' : ''}`}
                    onClick={() => {
                      if (isCollapsed) {
                        setExpandedHours(prev => ({ ...prev, [hourNum]: true }));
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className={`font-mono text-xs font-bold ${isCurrentHour ? 'text-red-500 scale-105' : 'text-black/50'}`}>
                          {hourStr}
                        </span>
                        
                        {isCurrentHour && (
                          <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 bg-black text-[#F9F9F7] rounded">
                            CURRENT
                          </span>
                        )}

                        {hasOverdue && (
                          <span className="text-[10px] text-red-500 font-bold uppercase tracking-wider flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> ค้างหลุดตรวจ (OVERDUE)
                          </span>
                        )}
                        {allDone && isPastHour && (
                          <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> DONE
                          </span>
                        )}

                        {isCollapsed && hourTasks.length > 0 && (
                          <span className="text-[10px] text-black/40 italic">
                            ({hourTasks.length} ภารกิจ - {hourTasks.map(t => t.name.slice(0, 15) + '...').join(', ')})
                          </span>
                        )}
                      </div>

                      {!isCollapsed && !isCurrentHour && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedHours(prev => ({ ...prev, [hourNum]: false }));
                          }}
                          className="text-[10px] font-bold text-black/40 hover:text-black uppercase tracking-widest"
                        >
                          ย่อลง [Collapse]
                        </button>
                      )}
                    </div>

                    {!isCollapsed && (
                      <div className="mt-4 space-y-2">
                        {hourTasks.length === 0 ? (
                          <p className="text-xs text-black/30 italic py-2 font-mono">ไม่มีตารางภารกิจประจำชั่วโมงนี้</p>
                        ) : (
                          hourTasks.map(t => {
                            const status = getTaskStatus(t.id, todayStr, hourStr);
                            const isDone = status === 'done';
                            const isSkipped = status === 'skipped';
                            const noteKey = `${t.id}-${hourStr}`;
                            
                            const logEntry = (logs[todayStr] || []).find(l => l.taskId === t.id && l.timeSlot === hourStr);
                            const legacyNoteText = logEntry?.note || '';
                            const hasActiveLegacyNote = legacyNoteText.trim() !== '' && legacyNoteText.trim() !== '-';
                            
                            const taskSpecificNotes = logEntry?.notes || [];
                            const uncompletedTaskSpecificNotes = taskSpecificNotes.filter(n => !n.done);
                            
                            const linkedShortnotes = shortnotes.filter(sn => sn.linkedTaskId === t.id && !sn.archived && !sn.deleted);
                            const uncompletedLinkedShortnotes = linkedShortnotes.filter(sn => !sn.done);

                            const hasMemo = hasActiveLegacyNote || taskSpecificNotes.length > 0 || linkedShortnotes.length > 0;
                            
                            const isWarningStyle = isDone && (hasActiveLegacyNote || uncompletedTaskSpecificNotes.length > 0 || uncompletedLinkedShortnotes.length > 0);
                            
                            return (
                              <div 
                                key={t.id} 
                                className={`rounded p-3 shadow-sm transition-all duration-300 ${
                                  isWarningStyle 
                                    ? 'border-2 border-amber-400 bg-amber-50/90 hover:bg-amber-100/90 shadow-md ring-2 ring-amber-200/50' 
                                    : 'border border-black/5 bg-[#FDFDFD] hover:border-black/10'
                                  }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  
                                  {/* Checkbox trigger */}
                                  <button 
                                    onClick={() => handleUpdateTaskStatus(t.id, isDone ? 'pending' : 'done', hourStr)}
                                    className={`w-10 h-10 border rounded flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                                      isDone 
                                        ? isWarningStyle 
                                          ? 'bg-amber-500 border-amber-500 text-white' 
                                          : 'bg-black border-black text-white' 
                                        : 'border-black/20 hover:border-black/40 text-transparent hover:text-black/20 bg-white'
                                    }`}
                                  >
                                    <Check className="w-5 h-5 stroke-[3px]" />
                                  </button>
 
                                  <div className="flex-1 pt-1 min-w-0">
                                    {/* Task name — always on its own line, never mixed with badges */}
                                    <p className={`text-sm font-semibold leading-snug break-words ${isDone && !isWarningStyle ? 'line-through text-black/40 font-normal' : isSkipped ? 'text-black/30 italic line-through' : 'text-[#121212]'}`}>
                                      {t.name}
                                    </p>

                                    {/* Badges row — separate line below task name */}
                                    {hasMemo && (
                                      <div className="mt-1.5">
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const parts: string[] = [];
                                            
                                            if (hasActiveLegacyNote) {
                                              parts.push(`📝 โน้ตเตือนระวังพิเศษ (Legacy Note):\n• ${legacyNoteText}`);
                                            }
                                            
                                            if (taskSpecificNotes.length > 0) {
                                              const noteLines = taskSpecificNotes.map(n => `[${n.done ? '✓' : ' '}] ${n.text} (${n.createdAt})`).join('\n');
                                              parts.push(`🎯 บันทึกย่อยประจำตัวงาน (${taskSpecificNotes.length} ข้อ):\n${noteLines}`);
                                            }
                                            
                                            if (linkedShortnotes.length > 0) {
                                              const shortnoteLines = linkedShortnotes.map(sn => {
                                                let line = `[${sn.done ? '✓' : ' '}] ${sn.text}`;
                                                if (sn.subtasks && sn.subtasks.length > 0) {
                                                  const subLines = sn.subtasks.map(s => `    - [${s.done ? '✓' : ' '}] ${s.text}`).join('\n');
                                                  line += `\n${subLines}`;
                                                }
                                                return line;
                                              }).join('\n\n');
                                              parts.push(`🔗 บันทึกความจำส่วนกลางที่เชื่อมโยงมา:\n${shortnoteLines}`);
                                            }
                                            
                                            setFocusedMemoContent({ 
                                              title: t.name, 
                                              content: parts.join('\n\n---\n\n') || 'มีรายการบันทึกช่วยจำ' 
                                            });
                                          }}
                                          className="inline-flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full select-none cursor-pointer shadow-xs animate-pulse"
                                          title="คลิกเพื่อเปิดอ่านบันทึกเตือนความจำ"
                                        >
                                          <FileText className="w-2.5 h-2.5 shrink-0" />
                                          <span>NOTED {uncompletedTaskSpecificNotes.length + uncompletedLinkedShortnotes.length + (hasActiveLegacyNote ? 1 : 0) > 0 ? `⚠️ (${uncompletedTaskSpecificNotes.length + uncompletedLinkedShortnotes.length + (hasActiveLegacyNote ? 1 : 0)})` : '✓'}</span>
                                        </button>
                                      </div>
                                    )}
                                    {isSkipped && (
                                      <span className="inline-block mt-1 text-[10px] bg-amber-50 text-amber-700 font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-200/50">
                                        ข้ามภารกิจแล้ว (SOP / SKIPPED)
                                      </span>
                                    )}

                                    {isWarningStyle && (
                                      <span className="inline-block mt-1.5 text-[9px] bg-amber-100 text-amber-800 font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-300 animate-pulse select-none">
                                        ⚠️ ตรวจสอบด่วน: ติ๊กเสร็จแล้วแต่มีโน้ตช่วยจำเตือนภัย!
                                      </span>
                                    )}
                                  </div>
 
                                  <div className="flex items-center space-x-1 shrink-0">
                                    <button 
                                      onClick={() => {
                                        if (isSkipped) {
                                          handleUpdateTaskStatus(t.id, 'pending', hourStr);
                                        } else {
                                          setActiveHandoverTask({ task: t, hourStr });
                                          setHandoverSkipNote('');
                                        }
                                      }}
                                      className={`p-2 rounded transition-all cursor-pointer flex items-center gap-1 ${
                                        isSkipped 
                                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                                          : 'text-black/50 hover:text-black hover:bg-black/5'
                                      }`}
                                      title={isSkipped ? "ยกเลิกการข้ามภารกิจ" : "ดูคู่มือขั้นตอนและบันทึกข้ามภารกิจ (SOP / SKIP)"}
                                    >
                                      <BookOpen className="w-3.5 h-3.5 shrink-0" />
                                      <span className="text-xs font-bold font-mono">SOP / SKIP</span>
                                    </button>
 
                                    <button 
                                      onClick={() => {
                                        setEditingNoteTaskId(editingNoteTaskId === noteKey ? null : noteKey);
                                        setNoteValues(prev => ({ ...prev, [noteKey]: '' }));
                                      }}
                                      className={`p-2 rounded hover:bg-black/5 ${editingNoteTaskId === noteKey ? 'text-red-500 font-bold' : 'text-black/50 hover:text-black'}`}
                                      title="เพิ่มบันทึกความจำเฉพาะรายการ (Add Task Note)"
                                    >
                                      <FileText className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
 
                                {/* RENDERING MULTIPLE TASK-SPECIFIC NOTES AND INPUT */}
                                {(editingNoteTaskId === noteKey || taskSpecificNotes.length > 0 || hasActiveLegacyNote) && (
                                  <div className="mt-3 pt-3 border-t border-black/5 space-y-2.5">
                                    <div className="text-[10px] uppercase tracking-wider font-bold text-black/50 flex items-center justify-between">
                                      <span className="flex items-center gap-1">
                                        <CornerDownRight className="w-3.5 h-3.5 text-black/30 animate-pulse" />
                                        บันทึกความจำเฉพาะรายการ ({taskSpecificNotes.length + (hasActiveLegacyNote ? 1 : 0)})
                                      </span>
                                      {(taskSpecificNotes.length > 0 || hasActiveLegacyNote) && (
                                        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                          uncompletedTaskSpecificNotes.length + (hasActiveLegacyNote ? 1 : 0) > 0
                                            ? 'bg-amber-100 text-amber-800 animate-pulse'
                                            : 'bg-emerald-100 text-emerald-800'
                                        }`}>
                                          {uncompletedTaskSpecificNotes.length + (hasActiveLegacyNote ? 1 : 0) > 0 ? `เตือนภัย ${uncompletedTaskSpecificNotes.length + (hasActiveLegacyNote ? 1 : 0)} จุด` : 'เรียบร้อยดี ✓'}
                                        </span>
                                      )}
                                    </div>

                                    {/* Task specific notes list */}
                                    <div className="space-y-1.5 pl-4">
                                      {hasActiveLegacyNote && (
                                        <div className="flex items-center justify-between gap-2 py-0.5 group/note bg-amber-50/50 p-1.5 rounded border border-amber-200/50">
                                          <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <button
                                              onClick={() => {
                                                // Convert legacy note to a TaskNote so it can be checked
                                                handleAddTaskNote(t.id, legacyNoteText, hourStr);
                                              }}
                                              className="w-4 h-4 rounded border border-amber-400 flex items-center justify-center shrink-0 transition-all cursor-pointer bg-white text-amber-600 hover:bg-amber-100"
                                              title="ติ๊กถูกเพื่อจัดการโน้ตนี้"
                                            >
                                              <Check className="w-2.5 h-2.5 text-transparent hover:text-amber-600" />
                                            </button>
                                            <span className="text-[11px] font-sans text-amber-800 font-bold leading-tight break-all">
                                              📝 {legacyNoteText}
                                            </span>
                                          </div>
                                        </div>
                                      )}

                                      {taskSpecificNotes.map(sn => (
                                        <div key={sn.id} className="flex items-start justify-between gap-2 py-1 group/note">
                                          <div className="flex items-start gap-2 min-w-0 flex-1">
                                            <button
                                              onClick={() => handleToggleTaskNote(t.id, sn.id, hourStr)}
                                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all cursor-pointer mt-0.5 ${
                                                sn.done 
                                                  ? 'bg-emerald-600 border-emerald-600 text-white' 
                                                  : 'border-black/20 hover:border-black/40 bg-white text-transparent'
                                              }`}
                                            >
                                              <Check className="w-2.5 h-2.5 stroke-[4px]" />
                                            </button>
                                            <div className="flex flex-col min-w-0 flex-1">
                                              <span className={`text-[11px] font-sans break-all leading-tight ${sn.done ? 'line-through text-black/35 font-normal' : 'text-black/85 font-semibold'}`}>
                                                {sn.text}
                                              </span>
                                              
                                              {/* Image proof thumbnail */}
                                              {sn.image && (
                                                <div className="mt-1">
                                                  <img 
                                                    src={sn.image} 
                                                    alt="Proof" 
                                                    className="w-16 h-16 object-cover rounded border border-black/10 cursor-pointer hover:opacity-85 transition-opacity shadow-xs"
                                                    onClick={() => setFocusedImageModal(sn.image)}
                                                  />
                                                </div>
                                              )}
                                              
                                              <span className="text-[8px] font-mono font-bold text-black/30 mt-0.5">({sn.createdAt})</span>
                                            </div>
                                          </div>
                                          <button
                                            onClick={() => handleDeleteTaskNote(t.id, sn.id, hourStr)}
                                            className="p-1 text-black/20 hover:text-red-500 transition-all cursor-pointer mt-0.5 shrink-0"
                                            title="ลบโน้ตย่อยนี้"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>

                                    {/* Inline input to add a new note */}
                                    {editingNoteTaskId === noteKey && (
                                      <div className="space-y-2 pl-4">
                                        <form
                                          onSubmit={(e) => {
                                            e.preventDefault();
                                            const draft = noteValues[noteKey] || '';
                                            if (draft.trim()) {
                                              handleAddTaskNote(t.id, draft, hourStr, noteImage[noteKey]);
                                              setNoteValues(prev => ({ ...prev, [noteKey]: '' }));
                                              setNoteImage(prev => ({ ...prev, [noteKey]: '' }));
                                            }
                                          }}
                                          className="flex gap-1.5"
                                        >
                                          <input
                                            type="text"
                                            value={noteValues[noteKey] || ''}
                                            onChange={(e) => setNoteValues(prev => ({ ...prev, [noteKey]: e.target.value }))}
                                            placeholder="เพิ่มบันทึกย่อยระวังภัย เช่น *ต้องเช็คไอดีลูกค้า*, *เช็คความถูกต้อง*..."
                                            className="flex-1 bg-[#F9F9F7] border border-black/10 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-black font-sans shadow-inner placeholder:text-black/30 text-[#121212] font-semibold"
                                          />
                                          <input
                                            type="file"
                                            id={`file-input-${noteKey}`}
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => handleFileChange(e, (base64) => setNoteImage(prev => ({ ...prev, [noteKey]: base64 })))}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => document.getElementById(`file-input-${noteKey}`)?.click()}
                                            className={`p-1.5 rounded border transition-all cursor-pointer shrink-0 flex items-center justify-center ${
                                              noteImage[noteKey] 
                                                ? 'bg-amber-500 border-amber-600 text-white' 
                                                : 'bg-white border-black/15 hover:bg-black/5 text-black/60 hover:text-black'
                                            }`}
                                            title="แนบรูปภาพเป็นหลักฐาน"
                                          >
                                            <Camera className="w-4 h-4" />
                                          </button>
                                          <button
                                            type="submit"
                                            className="bg-black hover:bg-black/80 text-white px-2.5 py-1.5 rounded text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center gap-0.5 shrink-0"
                                          >
                                            <Plus className="w-3 h-3" />
                                            <span>เพิ่มโน้ต</span>
                                          </button>
                                        </form>

                                        {noteImage[noteKey] && (
                                          <div className="flex items-center gap-2 bg-black/[0.01] border border-black/5 rounded p-1.5 inline-flex animate-fadeIn">
                                            <img
                                              src={noteImage[noteKey]}
                                              alt="Attached Preview"
                                              className="w-8 h-8 object-cover rounded border border-black/10"
                                            />
                                            <span className="text-[10px] text-black/50 font-medium">รูปภาพหลักฐานถูกเลือกแล้ว</span>
                                            <button
                                              type="button"
                                              onClick={() => setNoteImage(prev => ({ ...prev, [noteKey]: '' }))}
                                              className="text-red-500 hover:text-red-700 text-[10px] font-bold uppercase cursor-pointer ml-3"
                                            >
                                              ลบ
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* RIGHT: Unified Today's Memos & Notifications */}
            <div className="col-span-1 lg:col-span-5 overflow-y-auto bg-white p-6 md:p-8 flex flex-col space-y-4">
              
              {/* Unified Shortnotes (Noted) list as requested */}
              <div className="flex-1 flex flex-col">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 pb-3 border-b border-black/10">
                  <div className="space-y-0.5 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs uppercase tracking-[0.2em] font-black text-black">
                        บันทึกข้อสังเกต & สิ่งตรวจสอบวันนี้ (TODAY'S MEMO)
                      </h3>
                      {shortnotes.filter(n => !n.done && !n.archived && !n.deleted).length > 0 && (
                        <span className="bg-red-500 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full select-none shadow-sm animate-pulse flex items-center justify-center min-w-5 h-5">
                          {shortnotes.filter(n => !n.done && !n.archived && !n.deleted).length}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-black/40">
                      รายการจดดักจับสิ่งสำคัญ ขีดฆ่าเพื่อจบงาน หรือกดปุ่มเก็บงานที่ทำเสร็จแล้ว
                    </p>
                  </div>

                  {/* Archive Completed Button / ปุ่มเก็บรายการที่เสร็จสิ้น */}
                  {shortnotes.some(n => !n.archived && !n.deleted && n.done) && (
                    <button
                      onClick={handleArchiveCompletedShortnotes}
                      className="bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-800 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all shadow-xs cursor-pointer flex items-center gap-1 shrink-0"
                      title="เก็บกวาดบันทึกที่ทำเสร็จแล้วทั้งหมดเข้าแฟ้มประวัติทันทีเพื่อความสมองโล่ง"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>เก็บงานเสร็จ ({shortnotes.filter(n => !n.archived && !n.deleted && n.done).length})</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2.5 overflow-y-auto flex-1 max-h-[720px] pr-2">
                  {(() => {
                    const sortedShortnotes = shortnotes
                      .filter(n => !n.archived && !n.deleted && !(n.done && n.date !== todayStr))
                      .sort((a, b) => {
                        // 1. Pinned (and not done) first
                        const aPin = a.pinned && !a.done;
                        const bPin = b.pinned && !b.done;
                        if (aPin && !bPin) return -1;
                        if (!aPin && bPin) return 1;

                        // 2. Not done first
                        if (!a.done && b.done) return -1;
                        if (a.done && !b.done) return 1;

                        // 3. Newest first
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                      });

                    if (sortedShortnotes.length === 0) {
                      return (
                        <div className="text-center py-12 border border-dashed border-black/10 rounded-lg bg-black/[0.01] space-y-1.5">
                          <p className="text-xs text-black/40 italic font-medium">
                            ยังไม่มีบันทึกช่วยจำสำหรับวันนี้
                          </p>
                          <p className="text-[10px] text-black/30">
                            กดปุ่ม "เพิ่มบันทึกด่วน" บนเมนูด้านซ้ายเพื่อเพิ่มสิ่งบันทึกเตือนความจำ
                          </p>
                        </div>
                      );
                    }

                    return sortedShortnotes.map(n => {
                      const timeStr = new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const linkedTask = tasks.find(t => t.id === n.linkedTaskId);
                      return (
                        <div 
                          key={n.id} 
                          className={`flex flex-col border rounded p-4 transition-all duration-200 relative gap-3 ${
                            n.pinned 
                              ? 'bg-amber-50/50 border-amber-300/60 shadow-md hover:border-amber-400' 
                              : n.done 
                                ? 'bg-black/[0.01] border-black/5 opacity-60' 
                                : 'bg-[#FDFDFD] border-black/10 shadow-sm hover:border-black/20'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start space-x-3 flex-1 min-w-0">
                              {/* Checkbox */}
                              <button 
                                onClick={() => handleToggleShortnote(n.id)}
                                className={`w-6.5 h-6.5 rounded border flex items-center justify-center shrink-0 transition-all cursor-pointer mt-0.5 ${
                                  n.done 
                                    ? 'bg-black border-black text-white' 
                                    : n.pinned
                                      ? 'border-amber-400/50 hover:border-amber-500 bg-white text-transparent'
                                      : 'border-black/25 hover:border-black/40 text-transparent hover:text-black/20 bg-white'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 stroke-[3.5px]" />
                              </button>
 
                              <div className="min-w-0 flex-1 space-y-1">
                                {n.pinned && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-black text-amber-700 uppercase bg-amber-100 px-1.5 py-0.5 rounded-sm select-none mb-1">
                                    <Pin className="w-2.5 h-2.5 fill-amber-700" />
                                    ปักหมุด / PINNED
                                  </span>
                                )}
                                
                                <p className={`text-xs font-sans font-semibold leading-relaxed break-words ${n.done ? 'line-through text-black/40 font-normal' : 'text-black/90'}`}>
                                  {n.text}
                                </p>

                                {/* Memo proof image if present */}
                                {n.image && (
                                  <div className="mt-2.5">
                                    <img 
                                      src={n.image} 
                                      alt="Memo Proof" 
                                      className="max-h-36 max-w-full object-contain rounded border border-black/10 cursor-pointer hover:opacity-85 transition-opacity shadow-sm"
                                      onClick={() => setFocusedImageModal(n.image)}
                                    />
                                  </div>
                                )}
 
                                {/* LINKED TASK BADGE */}
                                {linkedTask && (
                                  <div className="mt-1.5 flex flex-wrap">
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-blue-700 bg-blue-50 border border-blue-200/50 px-2 py-0.5 rounded-full select-none">
                                      <Link2 className="w-2.5 h-2.5" />
                                      <span>ภารกิจ:</span>
                                      <span className="underline">{linkedTask.name}</span>
                                    </span>
                                  </div>
                                )}
 
                                <span className="text-[9px] font-mono font-bold text-black/30 mt-1 block">
                                  บันทึกเมื่อ {timeStr} น.
                                </span>
                              </div>
                            </div>
 
                            <div className="flex items-center space-x-1 shrink-0 ml-3 mt-0.5">
                              {/* Pin Toggle Button */}
                              <button 
                                onClick={() => handleTogglePinShortnote(n.id)}
                                className={`p-1.5 rounded transition-all cursor-pointer ${
                                  n.pinned 
                                    ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' 
                                    : 'text-black/20 hover:text-amber-500 hover:bg-amber-50'
                                }`}
                                title={n.pinned ? "ถอนหมุด" : "ปักหมุดข้อความนี้"}
                              >
                                <Pin className={`w-3.5 h-3.5 ${n.pinned ? 'fill-amber-600' : ''}`} />
                              </button>
 
                              {/* Delete Button */}
                              <button 
                                onClick={() => handleDeleteShortnote(n.id)}
                                className="p-1.5 rounded hover:bg-red-50 text-black/20 hover:text-red-600 transition-all cursor-pointer"
                                title="ลบบันทึกนี้"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* SUBTASK CHECKLIST SECTION */}
                          <div className="mt-1 pt-3 border-t border-black/5 space-y-2">
                            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider font-bold text-black/50">
                              <span>รายการตรวจสอบย่อย / SUBTASKS ({n.subtasks?.length || 0})</span>
                              {n.subtasks && n.subtasks.length > 0 && (
                                <span>
                                  เสร็จแล้ว {n.subtasks.filter(s => s.done).length}/{n.subtasks.length}
                                </span>
                              )}
                            </div>

                            {/* List of subtasks */}
                            {n.subtasks && n.subtasks.length > 0 && (
                              <div className="space-y-1.5 pl-1">
                                {n.subtasks.map(s => (
                                  <div key={s.id} className="flex items-center justify-between gap-2 group/sub py-0.5">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <button
                                        onClick={() => handleToggleShortnoteSubtask(n.id, s.id)}
                                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                                          s.done 
                                            ? 'bg-black border-black text-white' 
                                            : 'border-black/20 hover:border-black/40 bg-white'
                                        }`}
                                      >
                                        <Check className="w-2.5 h-2.5 stroke-[4px]" />
                                      </button>
                                      <span className={`text-[11px] font-sans break-all leading-tight ${s.done ? 'line-through text-black/35 font-normal animate-pulse' : 'text-black/80 font-medium'}`}>
                                        {s.text}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => handleDeleteShortnoteSubtask(n.id, s.id)}
                                      className="p-1 text-black/20 hover:text-red-500 transition-all cursor-pointer"
                                      title="ลบข้อนี้"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Add subtask inline input */}
                            <form 
                              onSubmit={(e) => {
                                e.preventDefault();
                                const draft = newSubtaskTexts[n.id] || '';
                                if (draft.trim()) {
                                  handleAddShortnoteSubtask(n.id, draft);
                                  setNewSubtaskTexts(prev => ({ ...prev, [n.id]: '' }));
                                }
                              }}
                              className="flex gap-1.5 mt-1"
                            >
                              <input 
                                type="text" 
                                value={newSubtaskTexts[n.id] || ''}
                                onChange={(e) => setNewSubtaskTexts(prev => ({ ...prev, [n.id]: e.target.value }))}
                                placeholder="เพิ่มรายการย่อย เช่น เช็คระบบไฟ, คัดเกรด..."
                                className="flex-1 bg-[#F9F9F7] border border-black/10 rounded px-2.5 py-1 text-[10px] focus:outline-none focus:border-black font-sans shadow-inner placeholder:text-black/30 text-[#121212] font-semibold"
                              />
                              <button 
                                type="submit"
                                className="bg-black hover:bg-black/80 text-white px-3 py-1 rounded text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center gap-0.5 shrink-0"
                              >
                                <Plus className="w-3 h-3" />
                                <span>เพิ่ม</span>
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

            </div>
          </div>

          {/* ======================================================= */}
          {/* VIEW: TASK MANAGEMENT (CRISP SYSTEMATIC TABLE & FORM)  */}
          {/* ======================================================= */}
          <div className={`absolute inset-0 grid grid-cols-1 lg:grid-cols-12 transition-all duration-300 ${currentView === 'management' ? 'opacity-100 z-10' : 'opacity-0 -z-10 pointer-events-none'}`}>
            
            {/* Left Panel: Form Section */}
            <div className="col-span-1 lg:col-span-5 border-r border-black/10 overflow-y-auto bg-white p-6 md:p-10 flex flex-col justify-between">
              <div>
                <button 
                  onClick={() => navigateTo('dashboard')}
                  className="inline-flex items-center text-[10px] font-black uppercase tracking-widest text-black/50 hover:text-black mb-6 group transition-all"
                >
                  <ChevronLeft className="w-4 h-4 mr-1 group-hover:-translate-x-1 transition-transform" /> Back to Dashboard
                </button>

                <h2 className="text-3xl font-serif italic mb-6 border-b border-black/10 pb-3 font-bold">
                  {editingTaskId ? 'แก้ไขงาน (Edit Task)' : 'สร้างงานใหม่ (Add Task)'}
                </h2>

                <form onSubmit={handleFormSubmit} className="space-y-6">
                  {/* Task Name */}
                  <div className="space-y-2">
                    <label className="block text-[10px] uppercase tracking-widest font-black text-black/50">
                      ชื่องานภารกิจ (Task Name)
                    </label>
                    <input 
                      type="text" 
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="เช่น ออกกำลังกาย, ตรวจสอบเมล์เช้า..."
                      className="w-full bg-[#F9F9F7] border border-black/10 rounded px-4 py-3 text-sm focus:outline-none focus:border-black font-sans"
                      required
                    />
                  </div>

                  {/* Task Frequency Type */}
                  <div className="space-y-2">
                    <label className="block text-[10px] uppercase tracking-widest font-black text-black/50">
                      ประเภทความถี่ (Type)
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['hourly', 'daily', 'monthly'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            setFormType(type);
                            if (!editingTaskId) {
                              setFormHours([]);
                              setFormMonthlyDay('1');
                            }
                          }}
                          className={`py-3 border rounded text-xs font-black uppercase tracking-wider transition-all ${
                            formType === type 
                              ? 'bg-black border-black text-[#F9F9F7]' 
                              : 'bg-white border-black/10 text-black/50 hover:border-black/30'
                          }`}
                        >
                          {type === 'hourly' ? 'รายชั่วโมง' : type === 'daily' ? 'รายวัน' : 'รายเดือน'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Workday/Holiday filter options (Crucial update requested) */}
                  <div className="space-y-2 border-t border-black/5 pt-4">
                    <label className="block text-[10px] uppercase tracking-widest font-black text-black/50">
                      เงื่อนไขการปฏิบัติภารกิจ (Schedule Option)
                    </label>
                    <p className="text-[11px] text-black/40 italic">กำหนดให้เปิดเตือนเฉพาะวันทำงาน วันหยุด หรือระบุวันอิสระ</p>
                    
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { mode: 'all_days', label: 'ทำทุกๆ วัน (Everyday)' },
                        { mode: 'workdays', label: 'วันทำงานเท่านั้น (Mon-Fri)' },
                        { mode: 'holidays', label: 'วันหยุดเท่านั้น (Sat-Sun)' },
                        { mode: 'custom_days', label: 'ระบุกำหนดวันเอง' }
                      ].map(({ mode, label }) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setFormScheduleMode(mode as any);
                            if (mode !== 'custom_days') {
                              setFormCustomDays([]);
                            }
                          }}
                          className={`py-2 px-3 border rounded text-xs font-bold transition-all text-left ${
                            formScheduleMode === mode 
                              ? 'bg-black border-black text-[#F9F9F7]' 
                              : 'bg-white border-black/10 text-black/60 hover:border-black/30'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Days selector list if 'custom_days' */}
                  {formScheduleMode === 'custom_days' && (
                    <div className="space-y-2 animate-fadeIn p-3 bg-black/[0.02] border border-black/5 rounded">
                      <label className="block text-[10px] uppercase tracking-widest font-black text-black/40">
                        เลือกวันที่ต้องการเตือนทำ (Select Active Days)
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {DAY_NAMES.map((day, i) => {
                          const isSelected = formCustomDays.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => {
                                if (formCustomDays.includes(day)) {
                                  setFormCustomDays(formCustomDays.filter(d => d !== day));
                                } else {
                                  setFormCustomDays([...formCustomDays, day]);
                                }
                              }}
                              className={`py-2 text-xs font-bold border rounded transition-all ${
                                isSelected 
                                  ? 'bg-black text-[#F9F9F7] border-black' 
                                  : 'bg-white border-black/10 text-black/60 hover:border-black/30'
                              }`}
                            >
                              {DAY_NAMES_TH[i].slice(0, 3)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Hourly grid timing select */}
                  {formType === 'hourly' && (
                    <div className="space-y-3 animate-fadeIn pt-2 border-t border-black/5">
                      <label className="block text-[10px] uppercase tracking-widest font-black text-black/50">
                        เลือกช่วงเวลาปฏิบัติงาน (Select Hours)
                      </label>
                      <div className="grid grid-cols-4 gap-2 max-h-[160px] overflow-y-auto p-2 border border-black/5 rounded bg-[#F9F9F7]">
                        {Array.from({ length: 24 }).map((_, i) => {
                          const hourStr = i.toString().padStart(2, '0') + ':00';
                          const isSelected = formHours.includes(hourStr);
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => toggleFormHour(hourStr)}
                              className={`py-2 text-[11px] font-mono font-bold border rounded transition-all ${
                                isSelected 
                                  ? 'bg-black text-[#F9F9F7] border-black' 
                                  : 'bg-white border-black/10 text-black/60 hover:border-black/30'
                              }`}
                            >
                              {hourStr}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Monthly selection options */}
                  {formType === 'monthly' && (
                    <div className="space-y-3 animate-fadeIn pt-2 border-t border-black/5">
                      <label className="block text-[10px] uppercase tracking-widest font-black text-black/50">
                        เลือกวันทำกิจกรรมรายเดือน (Monthly Trigger Day)
                      </label>
                      <select 
                        value={formMonthlyDay}
                        onChange={(e) => setFormMonthlyDay(e.target.value)}
                        className="w-full bg-[#F9F9F7] border border-black/10 rounded px-4 py-3 text-sm focus:outline-none focus:border-black font-sans font-medium"
                      >
                        <option value="first_workday">🌟 วันแรกของเดือนที่เป็นวันทำงาน (First Workday)</option>
                        {Array.from({ length: 31 }).map((_, i) => (
                          <option key={i + 1} value={String(i + 1)}>
                            ทุกๆ วันที่ {i + 1} ของเดือน
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-amber-600 bg-amber-50 p-2.5 rounded border border-amber-100/50 leading-relaxed">
                        <strong>* การประมวลผลอัจฉริยะ:</strong> ระบบจะคำนวณหา "วันแรกของเดือนที่เป็นวันทำงาน" ของคุณโดยอัตโนมัติอ้างอิงจากตารางตั้งค่าวันทำงาน เพื่อป้องกันการชนวันหยุดสุดสัปดาห์
                      </p>
                    </div>
                  )}

                  {/* Handover SOP & Reference Image */}
                  <div className="space-y-3 pt-4 border-t border-black/5 animate-fadeIn">
                    <label className="block text-[10px] uppercase tracking-widest font-black text-black/50">
                      คู่มือสอนงาน / วิธีการปฏิบัติภารกิจทั่วไป (General Work SOP Instructions)
                    </label>
                    <p className="text-[11px] text-black/40 italic">
                      ระบุคำชี้แจงขั้นตอนการทำงานนี้โดยละเอียด เพื่อให้ผู้รับช่วงหรือตัวคุณเองสามารถปฏิบัติตามได้ทันที (ทางเลือก: หากไม่ต้องการแยกรายขั้นตอน)
                    </p>
                    <textarea
                      value={formHandoverSop}
                      onChange={(e) => setFormHandoverSop(e.target.value)}
                      placeholder="เช่น: 1. เข้าสู่หน้าเว็บระบบหลัก\n2. ไปที่เมนูตรวจสอบ... แล้วคลิก...\n3. กรอกรหัส ID แล้วกดบันทึกผล"
                      rows={4}
                      className="w-full bg-[#F9F9F7] border border-black/10 rounded px-4 py-3 text-xs focus:outline-none focus:border-black font-sans leading-relaxed"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] uppercase tracking-widest font-black text-black/50">
                      รูปภาพประกอบสอนงานทั่วไป (General Reference Image)
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="file"
                        id="handover-image-input"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleFileChange(e, (base64) => setFormHandoverImage(base64))}
                      />
                      <button
                        type="button"
                        onClick={() => document.getElementById('handover-image-input')?.click()}
                        className="bg-white hover:bg-black/5 border border-black/15 text-black px-4 py-2 rounded text-xs font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{formHandoverImage ? 'เปลี่ยนรูปภาพประกอบ' : 'อัปโหลดรูปภาพสอนงาน'}</span>
                      </button>
                      {formHandoverImage && (
                        <button
                          type="button"
                          onClick={() => setFormHandoverImage('')}
                          className="text-red-500 hover:text-red-700 text-xs font-bold uppercase shrink-0 cursor-pointer"
                        >
                          ลบรูปภาพ
                        </button>
                      )}
                    </div>
                    {formHandoverImage && (
                      <div className="mt-2 border border-black/10 rounded-lg p-2 bg-black/[0.01] inline-block">
                        <img
                          src={formHandoverImage}
                          alt="Handover Preview"
                          className="max-h-36 object-contain rounded"
                        />
                      </div>
                    )}
                  </div>

                  {/* Structured SOP Steps section */}
                  <div className="space-y-4 pt-4 border-t border-black/5">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] uppercase tracking-widest font-black text-black/50">
                        ขั้นตอนคู่มือปฏิบัติงานแยกตามหัวข้อ (Step-by-Step SOP Checklist)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const newStep: SopStep = {
                            id: 'step_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                            stepNumber: formSopSteps.length + 1,
                            title: `ขั้นตอนที่ ${formSopSteps.length + 1}`,
                            instruction: '',
                            images: []
                          };
                          setFormSopSteps([...formSopSteps, newStep]);
                        }}
                        className="text-xs font-bold text-amber-600 hover:text-amber-700 uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> เพิ่มขั้นตอนย่อยใหม่
                      </button>
                    </div>
                    <p className="text-[11px] text-black/40 italic">
                      ระบุหัวข้อรายละเอียด และอัปโหลดรูปภาพประกอบรายขั้นตอน (ช่วยป้องกันข้อจำกัดเรื่องขนาดของรูปเดียว และกดย่อขยายดูรูปขนาดเต็มได้ทันที!)
                    </p>

                    {formSopSteps.length === 0 ? (
                      <div className="border border-dashed border-black/10 rounded-xl p-5 text-center text-xs text-black/40 bg-black/[0.005]">
                        ยังไม่มีขั้นตอนย่อยรายหัวข้อในภารกิจนี้ (กด "เพิ่มขั้นตอนย่อยใหม่" ด้านบนเพื่อเริ่มสร้างคู่มือพร้อมรูปประกอบทีละขั้นตอน)
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {formSopSteps.map((step, idx) => {
                          const isCollapsed = !!collapsedSopSteps[step.id];
                          return (
                            <div key={step.id} className="bg-[#FAF9F5] border border-black/10 rounded-xl relative">
                              {/* Step header — always visible, click to collapse */}
                              <div
                                className="flex items-center justify-between p-3 cursor-pointer select-none"
                                onClick={() => setCollapsedSopSteps(prev => ({ ...prev, [step.id]: !prev[step.id] }))}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="text-[10px] font-black uppercase text-amber-700 bg-amber-50 border border-amber-200/50 px-2 py-0.5 rounded shrink-0">
                                    STEP {idx + 1}
                                  </span>
                                  <span className="text-xs font-semibold text-black/70 truncate">
                                    {step.title || `ขั้นตอนที่ ${idx + 1} (ยังไม่มีชื่อ)`}
                                  </span>
                                  {(step.images || []).length > 0 && (
                                    <span className="text-[9px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200/40 px-1.5 py-0.5 rounded shrink-0">
                                      {(step.images || []).length} รูป
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => {
                                      const updated = [...formSopSteps];
                                      [updated[idx], updated[idx - 1]] = [updated[idx - 1], updated[idx]];
                                      updated.forEach((s, i) => s.stepNumber = i + 1);
                                      setFormSopSteps(updated);
                                    }}
                                    className="p-1 text-black/40 hover:text-black hover:bg-black/5 rounded disabled:opacity-30 cursor-pointer"
                                    title="เลื่อนขึ้น"
                                  >
                                    <ChevronUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === formSopSteps.length - 1}
                                    onClick={() => {
                                      const updated = [...formSopSteps];
                                      [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
                                      updated.forEach((s, i) => s.stepNumber = i + 1);
                                      setFormSopSteps(updated);
                                    }}
                                    className="p-1 text-black/40 hover:text-black hover:bg-black/5 rounded disabled:opacity-30 cursor-pointer"
                                    title="เลื่อนลง"
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = formSopSteps.filter(s => s.id !== step.id);
                                      updated.forEach((s, i) => s.stepNumber = i + 1);
                                      setFormSopSteps(updated);
                                    }}
                                    className="p-1 text-red-500 hover:bg-red-50 rounded cursor-pointer"
                                    title="ลบขั้นตอนนี้"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                  <span className="p-1 text-black/30 cursor-pointer">
                                    {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                                  </span>
                                </div>
                              </div>

                              {/* Collapsible body */}
                              {!isCollapsed && (
                                <div className="px-4 pb-4 space-y-3 border-t border-black/5 pt-3">

                              {/* Step Title Input */}
                              <div className="grid grid-cols-1 gap-2.5">
                                <input
                                  type="text"
                                  placeholder="หัวข้อขั้นตอน (เช่น: Step 1 - เปิดเบราว์เซอร์ไปที่ลิงก์..., Step 2 - ล็อกอินด้วย..."
                                  value={step.title}
                                  onChange={(e) => {
                                    const updated = formSopSteps.map(s => s.id === step.id ? { ...s, title: e.target.value } : s);
                                    setFormSopSteps(updated);
                                  }}
                                  className="w-full bg-white border border-black/10 rounded px-3 py-2 text-xs focus:outline-none focus:border-black font-semibold text-[#121212]"
                                />
                                
                                <RichTextEditor
                                  value={step.instruction}
                                  onChange={(html) => {
                                    const updated = formSopSteps.map(s => s.id === step.id ? { ...s, instruction: html } : s);
                                    setFormSopSteps(updated);
                                  }}
                                  placeholder="พิมพ์คำอธิบายประกอบและรายละเอียดของขั้นตอนในหัวข้อนี้... (เลือกตัวหนา สี ไฮไลต์ ได้จากแถบเครื่องมือด้านบน)"
                                />
                              </div>

                              {/* Step Multi-Image Uploader */}
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="file"
                                    id={`sop-step-image-${step.id}`}
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                      const files = Array.from(e.target.files || []);
                                      const currentImages = step.images || [];
                                      const remaining = 10 - currentImages.length;
                                      if (files.length === 0) return;
                                      if (remaining <= 0) {
                                        alert('เพิ่มรูปได้สูงสุด 10 รูปต่อขั้นตอน');
                                        return;
                                      }
                                      const toProcess = files.slice(0, remaining);
                                      let processed = 0;
                                      const newImages: string[] = [];
                                      toProcess.forEach(file => {
                                        if (file.size > 5 * 1024 * 1024) {
                                          processed++;
                                          alert(`ไฟล์ "${file.name}" ใหญ่เกิน 5MB — ข้ามไป`);
                                          if (processed === toProcess.length) {
                                            if (newImages.length > 0) {
                                              const updated = formSopSteps.map(s => s.id === step.id ? { ...s, images: [...currentImages, ...newImages] } : s);
                                              setFormSopSteps(updated);
                                            }
                                          }
                                          return;
                                        }
                                        const img = new Image();
                                        const url = URL.createObjectURL(file);
                                        img.onload = () => {
                                          URL.revokeObjectURL(url);
                                          const MAX = 1600;
                                          let { width, height } = img;
                                          if (width > MAX || height > MAX) {
                                            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
                                            else { width = Math.round(width * MAX / height); height = MAX; }
                                          }
                                          const canvas = document.createElement('canvas');
                                          canvas.width = width; canvas.height = height;
                                          const ctx = canvas.getContext('2d');
                                          if (ctx) { ctx.drawImage(img, 0, 0, width, height); newImages.push(canvas.toDataURL('image/jpeg', 0.82)); }
                                          processed++;
                                          if (processed === toProcess.length) {
                                            const updated = formSopSteps.map(s => s.id === step.id ? { ...s, images: [...currentImages, ...newImages] } : s);
                                            setFormSopSteps(updated);
                                          }
                                        };
                                        img.onerror = () => { URL.revokeObjectURL(url); processed++; };
                                        img.src = url;
                                      });
                                      e.target.value = '';
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => document.getElementById(`sop-step-image-${step.id}`)?.click()}
                                    className="bg-white hover:bg-black/5 border border-black/15 text-black px-3 py-1.5 rounded text-[11px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1"
                                  >
                                    <Camera className="w-3 h-3 text-black/55" />
                                    <span>เพิ่มรูปภาพประกอบ ({(step.images || []).length}/10)</span>
                                  </button>
                                  {(step.images || []).length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = formSopSteps.map(s => s.id === step.id ? { ...s, images: [] } : s);
                                        setFormSopSteps(updated);
                                      }}
                                      className="text-red-500 hover:text-red-700 text-[11px] font-bold uppercase cursor-pointer"
                                    >
                                      ลบรูปทั้งหมด
                                    </button>
                                  )}
                                </div>

                                {/* Multi-image preview grid */}
                                {(step.images || []).length > 0 && (
                                  <div className="flex flex-wrap gap-2 p-2 bg-white border border-black/5 rounded-lg">
                                    {(step.images || []).map((imgSrc, imgIdx) => (
                                      <div key={imgIdx} className="relative group">
                                        <img
                                          src={imgSrc}
                                          alt={`Step ${idx + 1} รูปที่ ${imgIdx + 1}`}
                                          className="w-20 h-20 object-cover rounded border border-black/10 cursor-pointer hover:opacity-80 transition-opacity shadow-sm"
                                          onClick={() => setFocusedImageModal(imgSrc)}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const newImgs = (step.images || []).filter((_, i) => i !== imgIdx);
                                            const updated = formSopSteps.map(s => s.id === step.id ? { ...s, images: newImgs } : s);
                                            setFormSopSteps(updated);
                                          }}
                                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md cursor-pointer"
                                          title="ลบรูปนี้"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                        <div
                                          className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded cursor-pointer"
                                          onClick={() => setFocusedImageModal(imgSrc)}
                                        >
                                          <span className="text-white text-[9px] font-black">ขยาย</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                                </div>
                              )} {/* end collapsible body */}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Submit Actions */}
                  <div className="pt-4 flex gap-2">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="flex-1 py-4 bg-black text-[#F9F9F7] text-xs uppercase tracking-widest font-bold hover:bg-black/80 transition-all rounded shadow-md cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {isSaving ? (
                        <>
                          <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          กำลังบันทึก...
                        </>
                      ) : (
                        editingTaskId ? 'อัปเดตภารกิจบันทึก' : 'สร้างและจัดเก็บภารกิจ'
                      )}
                    </button>
                    {editingTaskId && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="py-4 px-6 border border-black/20 text-black/60 text-xs uppercase tracking-widest font-bold hover:bg-[#121212] hover:text-white transition-all rounded"
                      >
                        ยกเลิก
                      </button>
                    )}
                  </div>
                </form>
              </div>

              <div className="mt-8 pt-6 border-t border-black/10 text-[10px] uppercase tracking-widest text-black/30 leading-relaxed">
                ROUTINE WORKSPACE // DATABASE SYSTEM
                <br />
                REALTIME ADD/DELETE CAPABILITY ONLINE
              </div>
            </div>

            {/* Right Panel: Task Library view */}
            <div className="col-span-1 lg:col-span-7 overflow-y-auto p-6 md:p-10 flex flex-col bg-white">
              <h2 className="text-3xl font-serif italic mb-4 border-b border-black/10 pb-3 font-bold flex justify-between items-end">
                <span>คลังระเบียบงานทั้งหมด (Task Library)</span>
                <span className="font-mono text-xs text-black/40 font-bold">({tasks.length} รายการ)</span>
              </h2>

              {/* Phase 3A: Search + Phase 3C: Export/Import toolbar */}
              <div className="flex flex-col sm:flex-row gap-2 mb-5">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-black/35 pointer-events-none" />
                  <input
                    type="text"
                    value={taskLibrarySearch}
                    onChange={(e) => setTaskLibrarySearch(e.target.value)}
                    placeholder="ค้นหาชื่อภารกิจ..."
                    className="w-full bg-[#F9F9F7] border border-black/10 rounded-lg pl-9 pr-4 py-2 text-xs font-semibold text-[#121212] focus:outline-none focus:border-black placeholder:text-black/30"
                    style={{ colorScheme: 'light' }}
                  />
                  {taskLibrarySearch && (
                    <button onClick={() => setTaskLibrarySearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-black/35 hover:text-black cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={handleExportData}
                    className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer"
                    title="Export ข้อมูลทั้งหมดเป็น JSON"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                  <label
                    className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer"
                    title="Import ข้อมูลจาก backup JSON"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Import</span>
                    <input type="file" accept=".json" className="hidden" onChange={handleImportData} />
                  </label>
                </div>
              </div>

              {tasks.length === 0 ? (
                <div className="text-center py-20 border border-dashed border-black/10 rounded-lg bg-black/[0.01]">
                  <p className="text-base text-black/40 italic">
                    ไม่มีรายการภารกิจอยู่ในคลังขณะนี้
                  </p>
                  <p className="text-xs text-black/30 mt-1">
                    ใช้แบบฟอร์มด้านซ้ายเพื่อแต่งเติมภารกิจของคุณลงระบบ
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {(['hourly', 'daily', 'monthly'] as const).map((type) => {
                    const categoryTasks = tasks
                      .filter(t => t.type === type)
                      .filter(t => !taskLibrarySearch.trim() || t.name.toLowerCase().includes(taskLibrarySearch.toLowerCase()));
                    if (categoryTasks.length === 0) return null;

                    return (
                      <div key={type} className="space-y-3">
                        <div className="flex justify-between items-center border-b border-black/5 pb-2">
                          <h4 className="text-[11px] uppercase tracking-[0.2em] font-black text-black/40 font-mono">
                            {type === 'hourly' ? 'งานรายชั่วโมง (Hourly)' : type === 'daily' ? 'งานรายวันประจำกิจวัตร (Daily)' : 'งานประจำเดือนสรุป (Monthly)'}
                          </h4>
                          <span className="font-mono text-[10px] bg-black/5 text-black/50 px-2 py-0.5 rounded font-bold">
                            {categoryTasks.length} รายการ
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {categoryTasks.map((t) => {
                            let timingSummary = '';
                            if (t.type === 'hourly') {
                              timingSummary = t.timing.join(', ');
                            } else if (t.type === 'daily') {
                              timingSummary = 'รายวัน';
                            } else if (t.type === 'monthly') {
                              timingSummary = t.timing[0] === 'first_workday' 
                                ? 'วันแรกของเดือนที่เป็นวันทำงาน (First Workday)'
                                : `วันที่ ${t.timing[0]} ของเดือน`;
                            }

                            return (
                              <div 
                                key={t.id} 
                                className={`border rounded-lg p-4 flex flex-col justify-between transition-all duration-300 bg-white ${
                                  t.active 
                                    ? 'border-black/10 shadow-sm hover:border-black' 
                                    : 'border-black/5 opacity-50 bg-[#F9F9F7]'
                                }`}
                              >
                                <div>
                                  <div className="flex justify-between items-start gap-3">
                                    <h5 className="text-sm font-bold text-[#121212] leading-snug line-clamp-2">
                                      {t.name}
                                    </h5>
                                    
                                    <button 
                                      onClick={() => toggleTaskActive(t.id)}
                                      className={`w-9 h-5 rounded-full p-0.5 transition-all cursor-pointer ${
                                        t.active ? 'bg-black' : 'bg-black/10'
                                      }`}
                                      title={t.active ? "ปิดชั่วคราว (Deactivate)" : "เปิดใช้งาน (Activate)"}
                                    >
                                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                                        t.active ? 'translate-x-4' : 'translate-x-0'
                                      }`} />
                                    </button>
                                  </div>

                                  <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                                    <div className="flex items-center space-x-1 font-mono text-[10px] text-black/50 font-bold bg-[#F9F9F7] px-2 py-1 rounded border border-black/5">
                                      <Clock className="w-3 h-3" />
                                      <span>{timingSummary}</span>
                                    </div>
                                    
                                    {t.scheduleMode && (
                                      <span className="font-mono text-[9px] font-black uppercase bg-black text-[#F9F9F7] px-2 py-1 rounded">
                                        {t.scheduleMode === 'all_days' ? 'ทำทุกวัน' : t.scheduleMode === 'workdays' ? 'เฉพาะวันทำงาน' : t.scheduleMode === 'holidays' ? 'เฉพาะวันหยุด' : `ระบุวัน (${t.customDays?.length} วัน)`}
                                      </span>
                                    )}

                                    {t.handoverSop && (
                                      <span className="font-mono text-[9px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-300/40 px-2 py-1 rounded flex items-center gap-1">
                                        <BookOpen className="w-2.5 h-2.5" />
                                        <span>มีคู่มือสอนงาน</span>
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-4 pt-3 border-t border-black/5 flex justify-end space-x-2">
                                  <button 
                                    onClick={() => startEditTask(t)}
                                    className="p-2 rounded hover:bg-black/5 text-black/60 hover:text-black transition-all cursor-pointer"
                                    title="แก้ไขภารกิจ"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteTask(t.id)}
                                    className="p-2 rounded hover:bg-black/5 text-red-500 hover:text-red-700 transition-all cursor-pointer"
                                    title="ลบภารกิจถาวร"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* ======================================================= */}
          {/* VIEW: HISTORY (CALENDAR & AUDITING TIMELINE)            */}
          {/* ======================================================= */}
          <div className={`absolute inset-0 grid grid-cols-1 lg:grid-cols-12 transition-all duration-300 ${currentView === 'history' ? 'opacity-100 z-10' : 'opacity-0 -z-10 pointer-events-none'}`}>
            
            <div className="col-span-1 lg:col-span-5 border-r border-black/10 overflow-y-auto bg-white p-6 md:p-10 flex flex-col justify-between">
              <div>
                <button 
                  onClick={() => navigateTo('dashboard')}
                  className="inline-flex items-center text-[10px] font-black uppercase tracking-widest text-black/50 hover:text-black mb-6 group transition-all"
                >
                  <ChevronLeft className="w-4 h-4 mr-1 group-hover:-translate-x-1 transition-transform" /> Back to Dashboard
                </button>

                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-black/40">
                    รายงานประวัติรายเดือน
                  </h3>
                  
                  <div className="flex items-center space-x-1">
                    <button 
                      onClick={() => changeMonth(-1)}
                      className="p-1.5 rounded hover:bg-black/5 text-black"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-mono text-xs font-bold uppercase tracking-wider min-w-[90px] text-center">
                      {new Date(calendarYear, calendarMonth).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                    <button 
                      onClick={() => changeMonth(1)}
                      className="p-1.5 rounded hover:bg-black/5 text-black"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center mb-2">
                  {DAY_NAMES.map((day, idx) => (
                    <span key={day} className="font-mono text-[9px] font-black uppercase text-black/30">
                      {day}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1.5">
                  {generateCalendarDays().map((day, idx) => {
                    if (day.dayNum === null) {
                      return <div key={`empty-${idx}`} className="aspect-square bg-transparent" />;
                    }

                    const isSelected = selectedDateStr === day.dateStr;
                    const isToday = todayStr === day.dateStr;

                    return (
                      <button
                        key={day.dateStr}
                        onClick={() => setSelectedDateStr(day.dateStr)}
                        className={`aspect-square rounded flex flex-col items-center justify-center relative font-serif text-sm font-bold transition-all cursor-pointer ${day.statusColor} ${
                          isSelected ? 'ring-2 ring-black font-black scale-105 shadow-md bg-white' : ''
                        } ${isToday ? 'border-2 border-black' : ''}`}
                      >
                        <span>{day.dayNum}</span>
                        {isToday && (
                          <span className="absolute bottom-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-8 space-y-3">
                  <div className="font-mono text-[10px] uppercase text-black/40 tracking-wider pb-1 border-b border-black/5 font-black">
                    ตัวกรองรายการ (Filters)
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => setHistoryFilter('all')}
                      className={`w-full py-3 px-4 border rounded text-xs text-left font-bold transition-all ${
                        historyFilter === 'all' 
                          ? 'bg-black border-black text-[#F9F9F7]' 
                          : 'bg-[#F9F9F7] border-black/10 text-black/60 hover:border-black/30'
                      }`}
                    >
                      📋 ดูรายการตรวจประเมินทั้งหมด
                    </button>
                    <button 
                      onClick={() => setHistoryFilter('overdue')}
                      className={`w-full py-3 px-4 border rounded text-xs text-left font-bold transition-all ${
                        historyFilter === 'overdue' 
                          ? 'bg-red-500 border-red-500 text-white' 
                          : 'bg-[#F9F9F7] border-black/10 text-black/60 hover:border-black/30'
                      }`}
                    >
                      🔴 คัดเฉพาะงานค้างหลุดตรวจ (Overdue)
                    </button>
                    <button 
                      onClick={() => setHistoryFilter('notes')}
                      className={`w-full py-3 px-4 border rounded text-xs text-left font-bold transition-all ${
                        historyFilter === 'notes' 
                          ? 'bg-amber-500 border-amber-500 text-white' 
                          : 'bg-[#F9F9F7] border-black/10 text-black/60 hover:border-black/30'
                      }`}
                    >
                      📝 คัดเฉพาะที่มีข้อความสมองโล่ง (Notes)
                    </button>
                  </div>
                </div>

              </div>

              <div className="mt-8 pt-6 border-t border-black/10 text-[10px] uppercase tracking-widest text-black/30">
                AUDIT SYSTEM // LOCALPERSISTENCE SECURED
              </div>
            </div>

            {/* Right Panel: Daily Logs History timeline */}
            <div className="col-span-1 lg:col-span-7 overflow-y-auto p-6 md:p-10 bg-[#F9F9F7]">
              
              <div className="mb-6">
                <span className="text-[10px] uppercase tracking-widest font-black text-black/40">
                  ประวัติผลลัพธ์ของวันที่เลือก
                </span>
                <h2 className="text-3xl font-serif font-black italic text-black mt-1">
                  {selectedDateStr ? new Date(selectedDateStr).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'ยังไม่ได้ระบุวันที่'}
                </h2>
              </div>

              {(() => {
                const dateObj = selectedDateStr ? new Date(selectedDateStr) : new Date();
                const expected = getExpectedTasksForDate(dateObj);
                const dayLogs = logs[selectedDateStr] || [];
                const dayShortnotes = shortnotes.filter(sn => sn.date === selectedDateStr && !sn.deleted);

                let doneCount = 0;
                let skippedCount = 0;
                let overdueCount = 0;

                const expectedItems: { t: Task; slot?: string }[] = [];
                expected.forEach(t => {
                  if (t.type === 'hourly') {
                    t.timing.forEach(slot => {
                      expectedItems.push({ t, slot });
                    });
                  } else {
                    expectedItems.push({ t });
                  }
                });

                expectedItems.forEach(({ t, slot }) => {
                  const l = dayLogs.find(x => x.taskId === t.id && (slot ? x.timeSlot === slot : !x.timeSlot));
                  if (!l || l.status === 'pending') {
                    overdueCount++;
                  } else if (l.status === 'done') {
                    doneCount++;
                  } else if (l.status === 'skipped') {
                    skippedCount++;
                  }
                });

                const total = expectedItems.length;
                const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

                let filteredData = expectedItems.map(({ t, slot }) => {
                  const l = dayLogs.find(x => x.taskId === t.id && (slot ? x.timeSlot === slot : !x.timeSlot));
                  return {
                    id: slot ? `${t.id}-${slot}` : t.id,
                    name: slot ? `${t.name} (${slot})` : t.name,
                    type: t.type,
                    target: slot ? slot : t.type.toUpperCase(),
                    actual: l ? l.actualTime : '-',
                    status: (l && l.status !== 'pending') ? l.status : 'overdue',
                    note: l ? l.note : '',
                    notes: l ? l.notes || [] : []
                  };
                });

                if (historyFilter === 'overdue') {
                  filteredData = filteredData.filter(x => x.status === 'overdue');
                } else if (historyFilter === 'notes') {
                  filteredData = filteredData.filter(x => x.note || x.notes.length > 0);
                }

                return (
                  <div className="space-y-6">
                    {/* Five Column Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 border border-black/10 rounded-lg p-6 bg-white shadow-sm">
                      <div className="text-center col-span-2 md:col-span-1">
                        <span className="text-3xl font-serif italic font-bold text-black">{percent}%</span>
                        <div className="text-[9px] uppercase tracking-wider font-bold text-black/40 mt-1">SUCCESS RATE</div>
                      </div>
                      <div className="text-center border-l border-black/10">
                        <span className="text-3xl font-serif italic font-bold text-emerald-600">{doneCount}</span>
                        <div className="text-[9px] uppercase tracking-wider font-bold text-black/40 mt-1">DONE</div>
                      </div>
                      <div className="text-center border-l border-black/10">
                        <span className="text-3xl font-serif italic font-bold text-amber-500">{skippedCount}</span>
                        <div className="text-[9px] uppercase tracking-wider font-bold text-black/40 mt-1">SKIPPED</div>
                      </div>
                      <div className="text-center border-l border-black/10">
                        <span className="text-3xl font-serif italic font-bold text-red-500">{overdueCount}</span>
                        <div className="text-[9px] uppercase tracking-wider font-bold text-black/40 mt-1">OVERDUE</div>
                      </div>
                      <div className="text-center border-l border-black/10 col-span-2 md:col-span-1">
                        <span className={`text-3xl font-serif italic font-bold ${dayShortnotes.length > 0 ? 'text-amber-600 animate-pulse' : 'text-black/30'}`}>
                          {dayShortnotes.length}
                        </span>
                        <div className="text-[9px] uppercase tracking-wider font-bold text-black/40 mt-1">MEMO ALERTS ⚠️</div>
                      </div>
                    </div>

                    {/* Historical Daily Alerts (NOTI AUDIT) */}
                    {dayShortnotes.length > 0 && (
                      <div className="border-2 border-amber-300 bg-amber-50/20 rounded-xl p-5 md:p-6 space-y-3.5">
                        <h4 className="text-[11px] uppercase tracking-[0.2em] font-black text-amber-800 flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-amber-600 animate-pulse" />
                          บันทึกข้อความ / การแจ้งเตือนด่วนในวันนี้ (DAILY NOTI AUDIT)
                        </h4>
                        <div className="space-y-3">
                          {dayShortnotes.map(sn => {
                            const linkedTaskName = tasks.find(t => t.id === sn.linkedTaskId)?.name;
                            return (
                              <div key={sn.id} className="bg-white border border-amber-200/60 rounded-lg p-3.5 shadow-xs flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <p className="text-xs font-semibold text-black leading-snug font-mono">
                                    📢 {sn.text}
                                  </p>
                                  {linkedTaskName && (
                                    <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                                      🔗 เชื่อมโยง: {linkedTaskName}
                                    </span>
                                  )}
                                  {sn.subtasks && sn.subtasks.length > 0 && (
                                    <div className="mt-2 pl-3 border-l border-amber-300 space-y-1">
                                      {sn.subtasks.map((st, sidx) => (
                                        <p key={sidx} className={`text-[11px] flex items-center gap-1 text-black/60 ${st.done ? 'line-through text-black/35' : ''}`}>
                                          <span>{st.done ? '✓' : '•'}</span>
                                          <span>{st.text}</span>
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border shrink-0 ${
                                  sn.done
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                                    : 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse'
                                }`}>
                                  {sn.done ? 'ทำแล้ว (RESOLVED)' : 'ค้างอยู่ (PENDING)'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <h4 className="text-[11px] uppercase tracking-[0.2em] font-black text-black/40">
                        ลำดับเหตุการณ์การตอบสนอง (TIMELINE AUDIT)
                      </h4>

                      {filteredData.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-black/10 rounded-lg bg-white">
                          <p className="text-sm text-black/40 italic">
                            ไม่มีรายการประวัติสำหรับตัวกรองนี้ในวันที่เลือก
                          </p>
                        </div>
                      ) : (
                        <div className="relative pl-6 border-l-2 border-black/10 space-y-6 py-2">
                          {filteredData.map((item) => {
                            let statusBadge = '';
                            let badgeStyle = '';
                            let dotColor = 'bg-black/20';

                            if (item.status === 'done') {
                              statusBadge = 'ทำสำเร็จ (DONE)';
                              badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200/50';
                              dotColor = 'bg-emerald-500 border-emerald-200 scale-110';
                            } else if (item.status === 'skipped') {
                              statusBadge = 'ส่งต่อเวร (HANDOVER)';
                              badgeStyle = 'bg-amber-50 text-amber-700 border-amber-200/50';
                              dotColor = 'bg-amber-500 border-amber-200';
                            } else {
                              statusBadge = 'ตกหล่นค้าง (OVERDUE)';
                              badgeStyle = 'bg-red-50 text-red-700 border-red-200/50';
                              dotColor = 'bg-red-500 border-red-200 scale-105';
                            }

                            return (
                              <div key={item.id} className="relative group">
                                <div className={`absolute -left-[31px] top-1.5 w-4.5 h-4.5 rounded-full border-4 border-[#F9F9F7] ${dotColor} transition-transform group-hover:scale-125`} />
                                
                                <div className="border border-black/10 rounded p-4 bg-white shadow-sm hover:border-black/30 transition-all">
                                  <div className="flex justify-between items-start gap-4">
                                    <div>
                                      <h5 className="text-sm font-bold text-[#121212] leading-tight">
                                        {item.name}
                                      </h5>
                                      <div className="mt-1 flex items-center space-x-2 font-mono text-[10px] text-black/40">
                                        <span>🎯 แผนงาน: {item.target}</span>
                                        <span>•</span>
                                        <span>⏱️ เวลาจริง: {item.actual}</span>
                                      </div>
                                    </div>

                                    <span className={`text-[9px] uppercase tracking-widest font-black px-2 py-0.5 rounded border ${badgeStyle} shrink-0`}>
                                      {statusBadge}
                                    </span>
                                  </div>

                                  {(item.note || item.notes.length > 0) && (
                                    <div className="mt-3 p-3.5 bg-[#F9F9F7] rounded-lg border-l-4 border-amber-400 text-xs text-black/85 font-sans leading-relaxed space-y-2">
                                      {item.note && (
                                        <p className="font-serif italic text-black/75">
                                          📝 {item.note}
                                        </p>
                                      )}
                                      {item.notes.length > 0 && (
                                        <div className="space-y-1.5 pt-1.5 border-t border-black/5">
                                          <p className="text-[10px] font-bold text-black/40 uppercase tracking-wider">บันทึกตรวจทานย่อยประจำงาน ({item.notes.length}):</p>
                                          {item.notes.map((sn: any) => (
                                            <p key={sn.id} className="flex items-center gap-1.5 text-[11px]">
                                              <span className={sn.done ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>
                                                {sn.done ? '✓ ทำแล้ว' : '⚠ ต้องเช็ค'}
                                              </span>
                                              <span className={sn.done ? 'line-through text-black/40 font-normal' : 'font-semibold text-black/80'}>{sn.text}</span>
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

            </div>

          </div>

        </div>

        {/* ======================================================= */}
        {/* VIEW: OPERATIONAL Q&A SEARCH SYSTEM                      */}
        {/* ======================================================= */}
        <div className={`absolute inset-0 grid grid-cols-1 lg:grid-cols-12 transition-all duration-300 ${currentView === 'qa' ? 'opacity-100 z-10' : 'opacity-0 -z-10 pointer-events-none'}`}>
          
          {/* Left Panel: Search & Controls */}
          <div className="col-span-1 lg:col-span-4 border-r border-black/10 overflow-y-auto bg-[#FAF9F5] p-6 md:p-8 flex flex-col justify-between">
            <div className="space-y-6">
              <div>
                <button 
                  onClick={() => navigateTo('dashboard')}
                  className="inline-flex items-center text-[10px] font-black uppercase tracking-widest text-black/50 hover:text-black mb-4 group transition-all"
                >
                  <ChevronLeft className="w-4 h-4 mr-1 group-hover:-translate-x-1 transition-transform" /> กลับหน้าควบคุม
                </button>

                <h2 className="text-2xl font-serif italic font-bold text-black flex items-center gap-2">
                  <HelpCircle className="w-6 h-6 text-black" /> Operational Q&A
                </h2>
                <p className="text-xs text-black/45 mt-1 font-sans">
                  ศูนย์ค้นหาข้อมูลวิธีทำภารกิจและส่งมอบเวรฉุกเฉิน
                </p>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-black/40">
                  <Search className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={qaSearchQuery}
                  onChange={(e) => setQaSearchQuery(e.target.value)}
                  placeholder="พิมพ์คีย์เวิร์ดเพื่อค้นหาคำถาม..."
                  className="w-full bg-white border border-black/10 rounded-lg pl-9 pr-4 py-2.5 text-xs focus:outline-none focus:border-black font-sans font-semibold text-[#121212]"
                />
                {qaSearchQuery && (
                  <button
                    onClick={() => setQaSearchQuery('')}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-black/45 hover:text-black text-[10px] uppercase font-black tracking-wider"
                  >
                    CLEAR
                  </button>
                )}
              </div>

              {/* Category Filters */}
              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-widest font-black text-black/45">
                  กรองตามหมวดหมู่ (Category Filter)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'all', label: 'ทั้งหมด', count: qas.length },
                    { key: 'handover', label: 'การส่งมอบเวร', count: qas.filter(q => q.category === 'handover').length },
                    { key: 'task', label: 'การทำภารกิจ', count: qas.filter(q => q.category === 'task').length },
                    { key: 'system', label: 'ปัญหาทางเทคนิค', count: qas.filter(q => q.category === 'system').length },
                  ].map((cat) => (
                    <button
                      key={cat.key}
                      onClick={() => setSelectedQaCategory(cat.key)}
                      className={`px-3 py-2.5 rounded-lg border text-left text-xs font-bold transition-all flex items-center justify-between ${
                        selectedQaCategory === cat.key
                          ? 'bg-black text-[#F9F9F7] border-black shadow-sm'
                          : 'bg-white text-black/60 border-black/10 hover:border-black/35'
                      }`}
                    >
                      <span className="truncate">{cat.label}</span>
                      <span className={`text-[9px] font-mono font-black ml-1.5 px-1.5 py-0.5 rounded ${
                        selectedQaCategory === cat.key ? 'bg-white/20 text-white' : 'bg-black/5 text-black/40'
                      }`}>
                        {cat.count}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Dynamic task-linked filters — only show tasks that actually have linked Q&A */}
                {(() => {
                  const linkedTaskIds = Array.from(new Set(qas.filter(q => q.linkedTaskId).map(q => q.linkedTaskId)));
                  if (linkedTaskIds.length === 0) return null;
                  return (
                    <div className="pt-1">
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-black/35 mb-1.5">
                        กรองตามงานที่เชื่อมโยง (Linked Task)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {linkedTaskIds.map(tid => {
                          const linkedTask = tasks.find(t => t.id === tid);
                          if (!linkedTask) return null;
                          const filterKey = `task:${tid}`;
                          const count = qas.filter(q => q.linkedTaskId === tid).length;
                          return (
                            <button
                              key={tid}
                              onClick={() => setSelectedQaCategory(filterKey)}
                              className={`px-2.5 py-1.5 rounded-full border text-[10px] font-bold transition-all flex items-center gap-1 ${
                                selectedQaCategory === filterKey
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-blue-50 text-blue-700 border-blue-200/50 hover:border-blue-400'
                              }`}
                            >
                              <Link2 className="w-2.5 h-2.5" />
                              <span className="truncate max-w-[140px]">{linkedTask.name}</span>
                              <span className="opacity-60">({count})</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Add QA Quick Button */}
              {!showAddQaForm ? (
                <button
                  onClick={() => setShowAddQaForm(true)}
                  className="w-full py-3 bg-white border border-dashed border-black/20 hover:border-black/65 text-black text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm hover:shadow-md"
                >
                  <Plus className="w-4 h-4" /> เพิ่มบันทึกคำถามใหม่ (Add QA)
                </button>
              ) : (
                <div className="bg-white border border-black/15 rounded-xl p-4 space-y-3.5 shadow-sm animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest font-black text-black/50">
                      สร้างรายการ Q&A ใหม่
                    </span>
                    <button
                      onClick={() => setShowAddQaForm(false)}
                      className="text-black/45 hover:text-black text-[10px] font-black uppercase"
                    >
                      ปิดฟอร์ม
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-black/45">
                      คำถาม (Question)
                    </label>
                    <input
                      type="text"
                      value={newQaQuestion}
                      onChange={(e) => setNewQaQuestion(e.target.value)}
                      placeholder="พิมพ์หัวข้อคำถาม..."
                      className="w-full bg-[#FBFBF9] border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-black font-sans font-semibold text-[#121212]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-black/45">
                      วิธีทำ / คำตอบ (Answer Details)
                    </label>
                    <textarea
                      value={newQaAnswer}
                      onChange={(e) => setNewQaAnswer(e.target.value)}
                      placeholder="พิมพ์อธิบายวิธีแก้ไขปัญหา หรือคู่มือปฏิบัติ..."
                      rows={3}
                      className="w-full bg-[#FBFBF9] border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-black font-sans font-semibold text-[#121212] leading-relaxed"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-black/45">
                      หมวดหมู่ (Category)
                    </label>
                    <select
                      value={newQaCategory}
                      onChange={(e) => setNewQaCategory(e.target.value)}
                      className="w-full bg-[#FBFBF9] border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-black font-sans font-bold text-[#121212]"
                    >
                      <option value="handover">การส่งมอบเวร (Handover)</option>
                      <option value="task">การทำภารกิจ (Task Guidance)</option>
                      <option value="system">ปัญหาทางเทคนิค (System Failure)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-black/45 flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      เชื่อมโยงกับงาน (Link to Task) — ไม่บังคับ
                    </label>
                    <select
                      value={newQaLinkedTaskId}
                      onChange={(e) => setNewQaLinkedTaskId(e.target.value)}
                      className="w-full bg-[#FBFBF9] border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-black font-sans font-bold text-[#121212]"
                      style={{ colorScheme: 'light' }}
                    >
                      <option value="">— ไม่เชื่อมโยง (None) —</option>
                      {tasks.map(t => (
                        <option key={t.id} value={t.id}>
                          [{t.type === 'hourly' ? 'รายชั่วโมง' : t.type === 'daily' ? 'รายวัน' : 'รายเดือน'}] {t.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-black/35 italic">
                      เลือกงานที่เกี่ยวข้อง เพื่อให้คำถามนี้แสดงเป็นหมวดหมู่แยกตามงานจริง
                    </p>
                  </div>

                  <button
                    onClick={() => handleAddQa(newQaQuestion, newQaAnswer, newQaCategory, newQaLinkedTaskId)}
                    disabled={!newQaQuestion.trim() || !newQaAnswer.trim()}
                    className="w-full py-2.5 bg-black hover:bg-black/85 disabled:bg-black/20 text-white text-xs font-black uppercase tracking-widest rounded-lg transition-all"
                  >
                    บันทึกคำถามคลังความรู้
                  </button>
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-black/5 text-[9px] text-black/35 font-mono select-none">
              <span>DATABASE REF: MBD_QAS</span>
            </div>
          </div>

          {/* Right Panel: Scrollable QA list */}
          <div className="col-span-1 lg:col-span-8 overflow-y-auto bg-white p-6 md:p-10">
            {(() => {
              // Filter logic
              const searchLower = qaSearchQuery.toLowerCase();
              const filtered = qas.filter(q => {
                const matchSearch = q.question.toLowerCase().includes(searchLower) || q.answer.toLowerCase().includes(searchLower);
                let matchCategory = true;
                if (selectedQaCategory === 'all') {
                  matchCategory = true;
                } else if (selectedQaCategory.startsWith('task:')) {
                  const tid = selectedQaCategory.slice(5);
                  matchCategory = q.linkedTaskId === tid;
                } else {
                  matchCategory = q.category === selectedQaCategory;
                }
                return matchSearch && matchCategory;
              });

              const linkedTaskLabel = selectedQaCategory.startsWith('task:')
                ? tasks.find(t => t.id === selectedQaCategory.slice(5))?.name
                : null;

              return (
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-black/5 pb-4">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-widest text-[#121212]">
                        รายการผลลัพธ์คำถาม ({filtered.length})
                      </h3>
                      <p className="text-[11px] text-black/40">คลิกที่การ์ดคำถามเพื่อกางดูเนื้อหาและวิธีปฏิบัติ</p>
                    </div>
                    
                    {selectedQaCategory !== 'all' && (
                      <span className="text-[9px] font-black uppercase tracking-wider bg-black text-white px-2 py-1 rounded flex items-center gap-1">
                        {linkedTaskLabel && <Link2 className="w-2.5 h-2.5" />}
                        หมวดหมู่: {linkedTaskLabel ?? selectedQaCategory}
                      </span>
                    )}
                  </div>

                  {filtered.length === 0 ? (
                    <div className="text-center py-24 border border-dashed border-black/10 rounded-2xl bg-black/[0.005] space-y-3">
                      <HelpCircle className="w-8 h-8 text-black/30 mx-auto" />
                      <h4 className="text-sm font-black text-black/70">ไม่พบคำตอบที่คุณค้นหา</h4>
                      <p className="text-xs text-black/40 max-w-sm mx-auto">
                        ลองเปลี่ยนคำค้นหา หรือกดปุ่ม "เพิ่มบันทึกคำถามใหม่" เพื่อเพิ่มความรู้เข้าคลังภารกิจ
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filtered.map((item) => {
                        const isExpanded = expandedQaId === item.id;
                        
                        // Category badge styling
                        let catLabel = 'การส่งต่อเวร';
                        let catStyle = 'bg-amber-50 text-amber-700 border-amber-200/50';
                        if (item.category === 'system') {
                          catLabel = 'ปัญหาทางเทคนิค';
                          catStyle = 'bg-red-50 text-red-700 border-red-200/50';
                        } else if (item.category === 'task') {
                          catLabel = 'การปฏิบัติงาน';
                          catStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200/50';
                        }

                        return (
                          <div 
                            key={item.id}
                            className={`border rounded-xl transition-all ${
                              isExpanded 
                                ? 'border-black bg-black/[0.005] shadow-md' 
                                : 'border-black/10 bg-white hover:border-black/30 shadow-sm'
                            }`}
                          >
                            {/* Header Trigger */}
                            <div 
                              onClick={() => setExpandedQaId(isExpanded ? null : item.id)}
                              className="p-5 flex items-start justify-between gap-4 cursor-pointer select-none"
                            >
                              <div className="space-y-1.5 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-[9px] uppercase tracking-wider font-black px-1.5 py-0.5 rounded border ${catStyle}`}>
                                    {catLabel}
                                  </span>
                                  {item.linkedTaskId && (() => {
                                    const linkedTask = tasks.find(t => t.id === item.linkedTaskId);
                                    if (!linkedTask) return null;
                                    return (
                                      <span className="text-[9px] uppercase tracking-wider font-black px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200/50 flex items-center gap-1">
                                        <Link2 className="w-2.5 h-2.5" />
                                        <span className="normal-case truncate max-w-[120px]">{linkedTask.name}</span>
                                      </span>
                                    );
                                  })()}
                                </div>
                                <h4 className="text-sm font-bold text-black leading-snug">
                                  {item.question}
                                </h4>
                              </div>

                              <div className="flex items-center gap-2.5 shrink-0 self-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteQa(item.id);
                                  }}
                                  className="p-1.5 text-black/30 hover:text-red-600 rounded hover:bg-black/5 transition-all"
                                  title="ลบคำถามนี้"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <span className="p-1 rounded bg-black/5 text-black">
                                  {isExpanded ? (
                                    <ChevronUp className="w-4 h-4" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4" />
                                  )}
                                </span>
                              </div>
                            </div>

                            {/* Answer Panel */}
                            {isExpanded && (
                              <div className="px-5 pb-5 pt-1 border-t border-black/5 animate-slideDown">
                                <div className="bg-white border border-black/10 rounded-lg p-4 font-sans text-xs text-black/85 leading-relaxed whitespace-pre-wrap font-medium shadow-inner">
                                  {item.answer}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

        </div>

        {/* FOOTER */}
        <footer className="h-10 bg-black text-[#F9F9F7]/70 flex items-center justify-between px-6 text-[8px] uppercase tracking-[0.3em] font-mono shrink-0 select-none z-30">
          <span>COPYRIGHT 2026 RESEARCH DEPT.</span>
          <span>GRID REF: 04.99.2</span>
          <span>BANGKOK / TOKYO</span>
        </footer>

      </main>

      {/* ======================================================= */}
      {/* DELETE CONFIRMATION DIALOG                              */}
      {/* ======================================================= */}
      {deletingTaskId !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white border border-black/15 p-6 md:p-8 max-w-md w-full rounded-lg shadow-xl text-center space-y-6">
            <div className="w-12 h-12 bg-red-50 border border-red-200 text-red-500 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-serif font-black italic text-[#121212]">คุณต้องการลบภารกิจนี้ถาวรใช่หรือไม่?</h3>
              <p className="text-xs text-black/50 leading-relaxed">
                การลบภารกิจ "<span className="font-bold text-black">{tasks.find(t => t.id === deletingTaskId)?.name}</span>" 
                จะทำให้ข้อมูลภารกิจนี้หายไปจากคลังอย่างถาวร แต่ประวัติการทำและบันทึกย้อนหลังยังคงอยู่
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => setDeletingTaskId(null)}
                className="flex-1 py-3 border border-black/15 text-xs font-bold uppercase tracking-widest rounded hover:bg-black/5 transition-all cursor-pointer text-[#121212]"
              >
                ยกเลิก (Cancel)
              </button>
              <button 
                onClick={confirmDeleteTask}
                className="flex-1 py-3 bg-red-600 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-red-700 transition-all cursor-pointer"
              >
                ยืนยันลบถาวร (Delete)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* DELETE SHORTNOTE CONFIRMATION DIALOG                    */}
      {/* ======================================================= */}
      {deletingShortnoteId !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white border border-black/15 p-6 md:p-8 max-w-md w-full rounded-lg shadow-xl text-center space-y-6">
            <div className="w-12 h-12 bg-red-50 border border-red-200 text-red-500 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-serif font-black italic text-[#121212]">คุณต้องการลบข้อความโน้ตย่อนี้ถาวรใช่หรือไม่?</h3>
              <p className="text-xs text-black/50 leading-relaxed">
                โน้ตข้อความ "<span className="font-bold text-black">{shortnotes.find(n => n.id === deletingShortnoteId)?.text}</span>" 
                จะถูกลบออกจากกระดานบันทึกของคุณอย่างถาวร
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => setDeletingShortnoteId(null)}
                className="flex-1 py-3 border border-black/15 text-xs font-bold uppercase tracking-widest rounded hover:bg-black/5 transition-all cursor-pointer text-[#121212]"
              >
                ยกเลิก (Cancel)
              </button>
              <button 
                onClick={confirmDeleteShortnote}
                className="flex-1 py-3 bg-red-600 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-red-700 transition-all cursor-pointer"
              >
                ยืนยันลบถาวร (Delete)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* MEMO CONTENTS MODAL DIALOG                              */}
      {/* ======================================================= */}
      {focusedMemoContent !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white border border-amber-300 p-6 md:p-8 max-w-lg w-full rounded-xl shadow-2xl space-y-6 relative overflow-hidden">
            {/* Top Amber Warning Accent Bar */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 to-amber-500" />
            
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-amber-50 border border-amber-200 text-amber-600 rounded-lg flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-black text-amber-700">
                    บันทึกแจ้งเตือนความจำระวังพิเศษ (WARNING MEMO)
                  </h4>
                  <h3 className="text-base font-serif font-bold italic text-black leading-tight">
                    {focusedMemoContent.title}
                  </h3>
                </div>
              </div>
              <button 
                onClick={() => setFocusedMemoContent(null)}
                className="p-1.5 rounded-full hover:bg-black/5 text-black/40 hover:text-black transition-all cursor-pointer"
                title="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-5 text-xs text-black/80 font-serif leading-relaxed italic whitespace-pre-wrap max-h-60 overflow-y-auto">
              {focusedMemoContent.content}
            </div>

            <div className="flex justify-end pt-2">
              <button 
                onClick={() => setFocusedMemoContent(null)}
                className="bg-black hover:bg-black/80 text-white text-xs font-bold uppercase tracking-widest px-6 py-3 rounded-lg shadow transition-all cursor-pointer"
              >
                รับทราบและระมัดระวัง (Acknowledged)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* CREATE NEW SHORTNOTE MODAL POP-UP                       */}
      {/* ======================================================= */}
      {showCreateMemoModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white border border-black/15 p-6 md:p-8 max-w-lg w-full rounded-xl shadow-2xl space-y-6 relative overflow-hidden">
            {/* Top Decorative bar */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-500 to-amber-600" />
            
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-amber-50 border border-amber-200 text-amber-600 rounded-lg flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-black text-amber-700">
                    เพิ่มบันทึก / ข้อความแจ้งเตือนด่วน (QUICK MEMO)
                  </h4>
                  <h3 className="text-base font-serif font-bold italic text-black leading-tight">
                    บันทึกเตือนความจำส่วนกลางใหม่
                  </h3>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowCreateMemoModal(false);
                  setQuickAddText('');
                  setSelectedTaskIdForNote('');
                  setMemoImage('');
                }}
                className="p-1.5 rounded-full hover:bg-black/5 text-black/40 hover:text-black transition-all cursor-pointer"
                title="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleQuickAdd} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wider font-black text-black/50">
                  ข้อความสิ่งบันทึกเตือนสติ / Memo Text:
                </label>
                <textarea 
                  value={quickAddText}
                  onChange={(e) => setQuickAddText(e.target.value)}
                  placeholder="พิมพ์เรื่องแจ้งเตือน เช่น *ระวังข้อมูลลูกค้าซ้ำซ้อน*, *ห้ามลืมตรวจสอบความปลอดภัยบ่ายสอง*..."
                  rows={3}
                  className="w-full bg-[#F9F9F7] border border-black/10 rounded-lg px-4 py-3 text-xs focus:outline-none focus:border-black font-sans shadow-inner font-medium placeholder:text-black/30 text-[#121212] resize-none"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wider font-black text-black/50 flex items-center gap-1">
                  <Link2 className="w-3.5 h-3.5 text-black/40" />
                  เชื่อมโยงกับงานจากคลัง / Link to routine task:
                </label>
                <select
                  value={selectedTaskIdForNote}
                  onChange={(e) => setSelectedTaskIdForNote(e.target.value)}
                  className="w-full bg-[#F9F9F7] border border-black/10 rounded-lg px-3 py-2.5 text-xs font-semibold focus:outline-none focus:border-black cursor-pointer text-[#121212] shadow-inner"
                >
                  <option value="">-- ไม่เชื่อมโยง (None) --</option>
                  {tasks.filter(t => t.active).map(t => (
                    <option key={t.id} value={t.id}>
                      [{t.type.toUpperCase()}] {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wider font-black text-black/50 flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5 text-black/40" />
                  แนบรูปภาพเป็นหลักฐาน (Proof Image):
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    id="memo-image-input"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFileChange(e, (base64) => setMemoImage(base64))}
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById('memo-image-input')?.click()}
                    className="bg-white hover:bg-black/5 border border-black/15 text-black px-4 py-2 rounded text-xs font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{memoImage ? 'เปลี่ยนรูปภาพ' : 'อัปโหลดรูปหลักฐาน'}</span>
                  </button>
                  {memoImage && (
                    <button
                      type="button"
                      onClick={() => setMemoImage('')}
                      className="text-red-500 hover:text-red-700 text-xs font-bold uppercase cursor-pointer"
                    >
                      ลบรูปภาพ
                    </button>
                  )}
                </div>
                {memoImage && (
                  <div className="mt-2 border border-black/10 rounded-lg p-2 bg-black/[0.01] inline-block animate-fadeIn">
                    <img
                      src={memoImage}
                      alt="Memo Preview"
                      className="max-h-24 object-contain rounded"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-black/5">
                <button 
                  type="button"
                  onClick={() => {
                    setShowCreateMemoModal(false);
                    setQuickAddText('');
                    setSelectedTaskIdForNote('');
                    setMemoImage('');
                  }}
                  className="border border-black/15 hover:bg-black/5 text-[#121212] text-xs font-bold uppercase tracking-widest px-5 py-3 rounded-lg transition-all cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button 
                  type="submit"
                  className="bg-black hover:bg-black/80 text-white text-xs font-bold uppercase tracking-widest px-5 py-3 rounded-lg shadow transition-all cursor-pointer"
                >
                  บันทึกเมโมด่วน
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* TASK HANDOVER / SKIP SOP DETAIL MODAL                   */}
      {/* ======================================================= */}
      {activeHandoverTask !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white border border-black/15 max-w-2xl w-full rounded-2xl shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
            {/* Top Cyan Accent Bar representing SOP/Training */}
            <div className="h-2 bg-gradient-to-r from-blue-500 to-indigo-600 shrink-0" />
            
            {/* Modal Header */}
            <div className="p-6 border-b border-black/5 flex items-start justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 border border-blue-200 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wider font-black bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      คู่มือขั้นตอนสอนงาน (SOP HANDOVER)
                    </span>
                    {activeHandoverTask.hourStr && (
                      <span className="text-[10px] font-mono font-bold bg-black/5 text-black/60 px-1.5 py-0.5 rounded">
                        รอบ {activeHandoverTask.hourStr}
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-black mt-1 leading-snug">
                    {activeHandoverTask.task.name}
                  </h3>
                </div>
              </div>
              <button 
                onClick={() => {
                  setActiveHandoverTask(null);
                  setHandoverSkipNote('');
                }}
                className="p-1.5 rounded-full hover:bg-black/5 text-black/40 hover:text-black transition-all cursor-pointer"
                title="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Structured SOP Steps Checklist Section */}
              {activeHandoverTask.task.sopSteps && activeHandoverTask.task.sopSteps.length > 0 ? (
                <div className="space-y-4">
                  <h4 className="text-[11px] uppercase tracking-wider font-black text-black/45 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ขั้นตอนคู่มือปฏิบัติภารกิจอย่างละเอียด (Step-by-Step SOP Checklist)
                  </h4>
                  {/* Progress summary */}
                  {(() => {
                    const total = activeHandoverTask.task.sopSteps!.length;
                    const sopStepChecked = sopStepCheckedByTask[activeHandoverTask.task.id] ?? {};
                    const done = Object.values(sopStepChecked).filter(Boolean).length;
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    return (
                      <div className="flex items-center gap-3 bg-white border border-black/10 rounded-lg px-3 py-2">
                        <div className="flex-1 bg-black/5 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all duration-500 ${pct === 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`text-[10px] font-mono font-black shrink-0 ${pct === 100 ? 'text-emerald-600' : 'text-black/50'}`}>
                          {done}/{total} {pct === 100 ? '✓ ครบทุก step!' : 'step'}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="space-y-4">
                    {activeHandoverTask.task.sopSteps.map((step, idx) => {
                      // Normalize: support both new images[] and legacy image string
                      const stepImages: string[] = (step.images && step.images.length > 0)
                        ? step.images
                        : (step.image ? [step.image] : []);
                      const currentTaskId = activeHandoverTask.task.id;
                      const isChecked = !!(sopStepCheckedByTask[currentTaskId]?.[idx]);
                      return (
                        <div key={step.id || idx} className={`border rounded-xl p-4 md:p-5 space-y-3 transition-all duration-200 ${isChecked ? 'bg-emerald-50/60 border-emerald-300/60' : 'bg-[#FAF9F5] border-black/10'}`}>
                          <div className="flex items-start gap-3">
                            {/* Step progress checkbox — persists per task across modal open/close */}
                            <button
                              type="button"
                              onClick={() => setSopStepCheckedByTask(prev => ({
                                ...prev,
                                [currentTaskId]: { ...(prev[currentTaskId] ?? {}), [idx]: !(prev[currentTaskId]?.[idx]) }
                              }))}
                              className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all cursor-pointer ${isChecked ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-black/25 text-transparent hover:border-emerald-400'}`}
                              title={isChecked ? 'ยกเลิกติ๊ก' : 'ติ๊กเสร็จแล้ว'}
                            >
                              <Check className="w-3.5 h-3.5 stroke-[3.5px]" />
                            </button>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[10px] font-mono font-black border px-2 py-0.5 rounded transition-all ${isChecked ? 'bg-emerald-100 text-emerald-800 border-emerald-200/50 line-through' : 'bg-amber-100 text-amber-800 border-amber-200/50'}`}>
                                  STEP {idx + 1}
                                </span>
                                {step.title && (
                                  <span className={`text-xs font-black font-sans transition-all ${isChecked ? 'text-black/40 line-through' : 'text-black/80'}`}>
                                    {step.title}
                                  </span>
                                )}
                                {stepImages.length > 0 && (
                                  <span className="text-[9px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200/50 px-1.5 py-0.5 rounded ml-auto shrink-0">
                                    {stepImages.length} รูป
                                  </span>
                                )}
                                {isChecked && (
                                  <span className="text-[9px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">✓ เสร็จแล้ว</span>
                                )}
                              </div>

                              {step.instruction && step.instruction.trim() !== '' && (
                                <RichTextDisplay
                                  html={step.instruction}
                                  className={`text-xs leading-relaxed mt-2 transition-all ${isChecked ? 'opacity-40' : ''}`}
                                />
                              )}

                              {/* Multi-image gallery — larger thumbnails, click to lightbox with prev/next */}
                              {stepImages.length > 0 && (
                                <div className="space-y-2 mt-2">
                                  <span className="text-[9px] uppercase tracking-wider font-black text-black/35">
                                    รูปภาพประกอบขั้นตอน ({stepImages.length} รูป — แตะเพื่อขยาย)
                                  </span>
                                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                                    {stepImages.map((imgSrc, imgIdx) => (
                                      <div
                                        key={imgIdx}
                                        className="relative group cursor-pointer overflow-hidden rounded-md border border-black/10 bg-white aspect-square flex items-center justify-center"
                                        onClick={() => openLightbox(stepImages, imgIdx)}
                                      >
                                        <img
                                          src={imgSrc}
                                          alt={`Step ${idx + 1} รูปที่ ${imgIdx + 1}`}
                                          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                          loading="lazy"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 flex items-center justify-center transition-all duration-200">
                                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0zM11 8v6M8 11h6" />
                                          </svg>
                                        </div>
                                        {stepImages.length > 1 && (
                                          <div className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[8px] font-mono font-bold px-1 rounded leading-tight">
                                            {imgIdx + 1}/{stepImages.length}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Legacy SOP / General instructions */}
              {(!activeHandoverTask.task.sopSteps || activeHandoverTask.task.sopSteps.length === 0) && (
                <div className="space-y-2">
                  <h4 className="text-[11px] uppercase tracking-wider font-black text-black/45 flex items-center gap-1">
                    <FileText className="w-4 h-4 text-black/45" />
                    วิธีการและขั้นตอนการทำงาน (Work SOP Instructions)
                  </h4>
                  {activeHandoverTask.task.handoverSop ? (
                    <div className="bg-[#FDFDFB] border border-black/10 rounded-xl p-5 text-sm text-black/85 leading-relaxed font-sans whitespace-pre-wrap font-medium shadow-inner">
                      {activeHandoverTask.task.handoverSop}
                    </div>
                  ) : (
                    <div className="bg-amber-50/50 border border-dashed border-amber-300 rounded-xl p-6 text-center space-y-2">
                      <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto" />
                      <p className="text-xs text-amber-800 font-bold">
                        ยังไม่มีรายละเอียดวิธีปฏิบัติงานสอนงานสำหรับรายการนี้
                      </p>
                      <p className="text-[10px] text-amber-700/60 leading-relaxed">
                        คุณสามารถตั้งค่าอธิบายขั้นตอนงานและรูปภาพประกอบประกอบการสอนงานได้ที่เมนู "คลังภารกิจ"
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Legacy Handover SOP Reference Image Section */}
              {(!activeHandoverTask.task.sopSteps || activeHandoverTask.task.sopSteps.length === 0) && activeHandoverTask.task.handoverImage && (
                <div className="space-y-2">
                  <h4 className="text-[11px] uppercase tracking-wider font-black text-black/45 flex items-center gap-1">
                    <Camera className="w-4 h-4 text-black/45" />
                    รูปภาพประกอบการทำงาน (SOP Reference Image)
                  </h4>
                  <div className="border border-black/10 rounded-xl p-3 bg-black/[0.01] flex justify-center">
                    <img
                      src={activeHandoverTask.task.handoverImage}
                      alt="Handover SOP Reference"
                      className="max-h-72 object-contain rounded-lg cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
                      onClick={() => setFocusedImageModal(activeHandoverTask.task.handoverImage)}
                    />
                  </div>
                </div>
              )}

              {/* Skip Reason / Note Form */}
              <div className="space-y-2 border-t border-black/5 pt-4">
                <label className="block text-[11px] uppercase tracking-wider font-black text-black/45">
                  ระบุสาเหตุการข้ามงาน / บันทึกประกอบ (Skip Reason / Note)
                </label>
                <p className="text-[11px] text-black/40 italic">
                  ระบุรายละเอียดหรือสาเหตุที่ต้องการข้ามภารกิจในรอบเวลานี้ เพื่อใช้ในระบบตรวจสอบย้อนหลัง
                </p>
                <textarea
                  value={handoverSkipNote}
                  onChange={(e) => setHandoverSkipNote(e.target.value)}
                  placeholder="เช่น: ดำเนินการชดเชยรอบเช้าแล้ว, ตรวจสอบแล้วไม่มีปัญหาไม่ต้องทำเพิ่ม, เลื่อนเนื่องจากระบบปรับปรุง..."
                  rows={3}
                  className="w-full bg-[#F9F9F7] border border-black/10 rounded-lg px-4 py-3 text-xs focus:outline-none focus:border-black font-sans leading-relaxed text-[#121212] font-semibold"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-black/5 bg-black/[0.01] flex flex-col sm:flex-row sm:justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActiveHandoverTask(null);
                  setHandoverSkipNote('');
                }}
                className="order-2 sm:order-1 px-5 py-3 border border-black/15 hover:bg-black/5 text-[#121212] text-xs font-bold uppercase tracking-widest rounded-lg transition-all cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
              {(() => {
                const stepsArr = activeHandoverTask.task.sopSteps ?? [];
                const totalSteps = stepsArr.length;
                const sopStepChecked = sopStepCheckedByTask[activeHandoverTask.task.id] ?? {};
                const doneSteps = Object.values(sopStepChecked).filter(Boolean).length;
                const allStepsDone = totalSteps > 0 && doneSteps >= totalSteps;

                if (allStepsDone) {
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        handleUpdateTaskStatus(
                          activeHandoverTask.task.id,
                          'done',
                          activeHandoverTask.hourStr,
                          handoverSkipNote || 'ทำครบทุกขั้นตอน SOP แล้ว'
                        );
                        setSopStepCheckedByTask(prev => {
                          const next = { ...prev };
                          delete next[activeHandoverTask.task.id];
                          return next;
                        });
                        setActiveHandoverTask(null);
                        setHandoverSkipNote('');
                      }}
                      className="order-1 sm:order-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-widest rounded-lg shadow-md hover:shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" />
                      ยืนยันเสร็จงาน (ครบ {totalSteps}/{totalSteps} ขั้นตอน)
                    </button>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => {
                      handleUpdateTaskStatus(
                        activeHandoverTask.task.id, 
                        'skipped', 
                        activeHandoverTask.hourStr,
                        handoverSkipNote
                      );
                      setActiveHandoverTask(null);
                      setHandoverSkipNote('');
                    }}
                    className="order-1 sm:order-2 px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold uppercase tracking-widest rounded-lg shadow-md hover:shadow-lg transition-all cursor-pointer"
                  >
                    ยืนยันข้ามงาน (Confirm Skip)
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* FULLSCREEN IMAGE LIGHTBOX — with zoom + pan              */}
      {/* ======================================================= */}
      {focusedImageModal && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 animate-fadeIn select-none"
          onClick={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}
        >
          <div
            className="relative w-full h-full flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onWheel={lbHandleWheel}
            onMouseDown={lbHandleMouseDown}
            onMouseMove={lbHandleMouseMove}
            onMouseUp={lbHandleMouseUp}
            onMouseLeave={lbHandleMouseUp}
            onTouchStart={lbHandleTouchStart}
            onTouchMove={lbHandleTouchMove}
            onTouchEnd={lbHandleTouchEnd}
            style={{ cursor: lbZoom > 1 ? (lbDragRef.current.dragging ? 'grabbing' : 'grab') : 'default' }}
          >
            <img
              src={focusedImageModal}
              alt="ขยายรูปใหญ่"
              draggable={false}
              className="max-w-full max-h-[82vh] object-contain rounded-xl shadow-2xl border border-white/10 transition-transform duration-100"
              style={{
                transform: `translate(${lbPan.x}px, ${lbPan.y}px) scale(${lbZoom})`,
                transformOrigin: 'center center',
              }}
            />

            {/* Prev button */}
            {lightboxImages.length > 1 && lightboxIndex > 0 && (
              <button
                onClick={() => lightboxNav(-1)}
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white text-black rounded-full flex items-center justify-center shadow-xl transition-all cursor-pointer z-10"
                title="รูปก่อนหน้า"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {/* Next button */}
            {lightboxImages.length > 1 && lightboxIndex < lightboxImages.length - 1 && (
              <button
                onClick={() => lightboxNav(1)}
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white text-black rounded-full flex items-center justify-center shadow-xl transition-all cursor-pointer z-10"
                title="รูปถัดไป"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}

            {/* Close button */}
            <button
              onClick={closeLightbox}
              className="absolute top-3 right-3 w-9 h-9 bg-white text-black rounded-full flex items-center justify-center shadow-xl hover:bg-black hover:text-white transition-all cursor-pointer z-10"
              title="ปิด"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Zoom controls */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 rounded-full px-1.5 py-1.5 z-10">
              <button
                onClick={lbZoomOut}
                disabled={lbZoom <= 1}
                className="w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-white/20 active:scale-95 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="ซูมออก"
              >
                <span className="text-lg font-bold leading-none">−</span>
              </button>
              <button
                onClick={lbZoomReset}
                className="px-2 h-8 flex items-center justify-center rounded-full text-white text-[10px] font-mono font-bold hover:bg-white/20 active:scale-95 transition-all cursor-pointer min-w-[40px]"
                title="รีเซ็ตซูม"
              >
                {Math.round(lbZoom * 100)}%
              </button>
              <button
                onClick={lbZoomIn}
                disabled={lbZoom >= 5}
                className="w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-white/20 active:scale-95 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="ซูมเข้า"
              >
                <span className="text-lg font-bold leading-none">+</span>
              </button>
            </div>

            {/* Image counter + hint */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 flex-wrap justify-center px-2 z-10">
              {lightboxImages.length > 1 && (
                <span className="bg-black/70 text-white text-[10px] font-mono font-bold px-3 py-1.5 rounded-full">
                  {lightboxIndex + 1} / {lightboxImages.length}
                </span>
              )}
              <span className="bg-black/70 text-white text-[9px] sm:text-[10px] font-mono font-bold px-3 py-1.5 rounded-full uppercase tracking-wider select-none pointer-events-none hidden sm:inline-block">
                {lbZoom > 1 ? 'ลากเพื่อเลื่อนภาพ · scroll เพื่อซูม' : 'scroll หรือ pinch เพื่อซูม'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
