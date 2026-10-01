/**
 * config.js — single source of truth for values shared across every page
 * (login, portals, admin command center). Edit values here once; every
 * page that imports from this file picks up the change automatically.
 *
 *   import { FIREBASE_CONFIG, GOOGLE_CLIENT_ID, APP_ID, PATHS, SESSION_DURATION_MS } from './js/config.js';
 */

// Firebase project config (public by design - see note below).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA_41WpdMjHJOU5s3gQ9aieIayZRvUoRLE',
  authDomain: 'kanyadet-school-admin.firebaseapp.com',
  projectId: 'kanyadet-school-admin',
  databaseURL: 'https://kanyadet-school-admin-default-rtdb.firebaseio.com',
  storageBucket: 'kanyadet-school-admin.firebasestorage.app',
  messagingSenderId: '409708360032',
  appId: '1:409708360032:web:a21d63e8cb5fa1ecabee05',
};

// Google OAuth Client ID, used by GoogleOneTap on login/signup pages.
export const GOOGLE_CLIENT_ID = '409708360032-ducbhdgd7384cnv6mh24eu59baerd8hi.apps.googleusercontent.com';

// Realtime Database paths - kept in one place so a rename never means
// hunting through every page for the old string.
export const APP_ID = 'default-app-id';

export const PATHS = {
  RESULTS_PATH: `Results/${APP_ID}/students`,
  LOCK_PATH: 'termLocks',
  AUDIT_PATH: 'audit_logs',
  ANNOUNCEMENTS_PATH: 'announcements',
  ATTENDANCE_PATH: 'attendance',
  LUNCH_PATH: 'lunch',
  CALENDAR_PATH: 'calendar', // calendar/{eventId} = {date, type, title, ...} — matches the "calendar" node in database.rules.json
  QE_ACTIVE_PATH: 'quickEntryActive', // {encodedCompound}/{uid} -> {name,uid,grade,compound,startedAt,lastActive,cell:{studentName,subject,value,updatedAt}} — written by the Results Portal's Quick Entry
  TIMETABLE_PATH: 'timetables', // timetables/{grade} = {mon:[...],tue:[...]...} (legacy per-grade view)
  RESOURCES_PATH: 'resources', // Firestore collection
  LEAVE_PATH: 'leaveRequests', // Firestore collection
  WELFARE_PATH: 'welfareContributions', // Firestore collection
  TEACHER_TT_PATH: 'teacherTimetables', // teacherTimetables/{section}/{teacherKey} = { name, days: {...} }
  TIMETABLE_TIMES_PATH: 'timetableTimes', // timetableTimes/{section} = [time strings, index-aligned to TT_SECTIONS periods] — legacy override, still mirrored by teachers.html for the Admin Command Center's Timetable screen
  TIMETABLE_STRUCTURE_PATH: 'timetableStructure', // timetableStructure/{section} = { days:[[key,label],...], periods:[{time,brk},...] } — full grid shape override set from teachers.html's "🏗️ Structure" editor
  CLASS_TT_PATH:'classTimetables', // classTimetables/{section}/{grade} = { name, days: {...} } — full grid shape override set from teachers.html's "🏗️ Structure" editor
  EXAM_STRUCTURE_PATH: 'examTimetableStructure', // examTimetableStructure/{section} = { days:[[key,label],...], periods:[{time,brk},...] } — the Examination Timetable Planner's own grid shape (separate from CLASS_TT_PATH / TIMETABLE_STRUCTURE_PATH, which are the class timetable)
  EXAM_WEEKS_PATH: 'examTimetableWeeks', // examTimetableWeeks/{section}/{mondayISO}/d{0-6}/s{slot} = {subject,teacher,teacherUid,note,updatedBy,updatedAt} — one exam sitting per cell, written by the Examination Timetable Planner
};

// Compulsory session length used by session-manager.js's SessionManager/guardPage.
export const SESSION_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/*
 * NOTE on safety: FIREBASE_CONFIG and GOOGLE_CLIENT_ID are meant to be
 * public - they're identifiers, not secrets, and ship in every page's
 * JS bundle regardless of whether they live here or inline. Actual
 * access control is enforced by your Firebase Auth rules / Firestore
 * security rules, not by hiding these values.
 */