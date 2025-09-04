// Global shared state and flags used across modules (non-module scripts)
// Use var to create global bindings accessible as identifiers.
var SET = null, modIdx = 0, qIdx = 0;
var flags = new Set(), answers = {};
var timerSec = 0, tickId = null;

// Review timer user preference
window.REVIEW_TIMER_PREF = window.REVIEW_TIMER_PREF || { mode: 'default', minutes: null };

// Restore cache holder
var RESTORE_CACHE = null;

// Feature flag
const FEATURE_SIMILAR = false;

// Last set meta storage key
const LAST_SET_KEY = 'dsat_last_set'; // {type:'url'|'blob', value:string}

// Run mode
var RUN_MODE = 'full'; // 'full' | 'rw' | 'math'
function getRunMode(){ return RUN_MODE; }
function runModeLabel(m = getRunMode()){
  return m==='rw' ? 'RW Only' : m==='math' ? 'Math Only' : 'Full';
}

