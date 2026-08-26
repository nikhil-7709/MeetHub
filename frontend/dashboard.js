const token = localStorage.getItem('meetingToken');
if (!token) location.href = 'index.html';

const getApiUrl = (path) => {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (window.location.port !== '3000') {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:3000${path}`;
  }
  return path;
};

const api = (url, options = {}) => fetch(getApiUrl(url), {
  ...options,
  headers: {
    ...(options.headers || {}),
    Authorization: token,
    'Content-Type': 'application/json'
  }
});

const meetingsContainer = document.querySelector('#meetings');
const modal = document.querySelector('#modal');
const searchInput = document.querySelector('#searchInput');
const filterImportance = document.querySelector('#filterImportance');

let allMeetings = [];
let serverBaseUrl = window.location.origin; // fallback

// Detects which platform a meeting link belongs to
function detectPlatform(url) {
  if (!url) return { name: 'Video Call', icon: '📹', color: '#1f6956' };
  if (url.includes('meet.google.com'))   return { name: 'Google Meet',   icon: '🟢', color: '#34a853' };
  if (url.includes('zoom.us'))           return { name: 'Zoom',          icon: '📹', color: '#2d8cff' };
  if (url.includes('teams.microsoft'))   return { name: 'Microsoft Teams',icon: '💬', color: '#5b5fc7' };
  if (url.includes('webex.com'))         return { name: 'Webex',         icon: '🌐', color: '#00ade5' };
  if (url.includes('whereby.com'))       return { name: 'Whereby',       icon: '🎥', color: '#4b37b7' };
  if (url.includes('meet.jit.si'))       return { name: 'Jitsi Meet',    icon: '📹', color: '#0098a0' };
  if (url.includes('gotomeeting.com'))   return { name: 'GoToMeeting',   icon: '📞', color: '#ed7d31' };
  return { name: 'Video Call', icon: '🔗', color: '#1f6956' };
}

// Called by platform pill buttons — sets prefix in input so user fills the rest
function setPlatformHint(prefix) {
  const input = document.querySelector('#meetingLink');
  if (input) {
    input.value = prefix;
    input.focus();
    input.setSelectionRange(prefix.length, prefix.length);
  }
}

// Fetch real LAN IP from server so invite links work across devices
async function fetchServerIp() {
  try {
    const res = await fetch(getApiUrl('/api/server-info'));
    if (res.ok) {
      const { ip, port } = await res.json();
      if (ip && ip !== 'localhost') {
        serverBaseUrl = `http://${ip}:${port}`;
        // Show network address banner so host knows what to share
        const bar = document.querySelector('#networkInfoBar');
        const addr = document.querySelector('#networkAddr');
        if (bar && addr) {
          addr.textContent = `http://${ip}:${port}`;
          bar.style.display = 'flex';
        }
      }
    }
  } catch (e) { /* fallback to window.location.origin */ }
}

document.querySelector('#greeting').textContent = `Hello, ${JSON.parse(localStorage.getItem('meetingUser') || '{"name":"there"}').name.split(' ')[0]}`;
document.querySelector('#logout').onclick = () => { localStorage.clear(); location.href = 'index.html'; };
document.querySelector('#openCreate').onclick = () => { modal.hidden = false; };
document.querySelector('#closeCreate').onclick = () => { modal.hidden = true; };

// Room Link Modal wiring
const roomLinkModal = document.querySelector('#roomLinkModal');
const generatedRoomLinkEl = document.querySelector('#generatedRoomLink');
const copyRoomLinkBtn = document.querySelector('#copyRoomLinkBtn');
const openRoomBtn = document.querySelector('#openRoomBtn');
document.querySelector('#closeRoomLinkModal').onclick = () => { roomLinkModal.hidden = true; };

copyRoomLinkBtn.onclick = () => {
  const link = generatedRoomLinkEl.textContent;
  if (!link) return;
  navigator.clipboard.writeText(link).then(() => {
    const orig = copyRoomLinkBtn.innerHTML;
    copyRoomLinkBtn.innerHTML = '✅ Copied!';
    copyRoomLinkBtn.classList.add('copied');
    setTimeout(() => { copyRoomLinkBtn.innerHTML = orig; copyRoomLinkBtn.classList.remove('copied'); }, 2500);
  }).catch(() => alert(`Video Call Link:\n${link}`));
};

async function loadMeetings() {
  try {
    const response = await api('/api/meetings');
    if (response.status === 401) return location.href = 'index.html';
    allMeetings = await response.json();
    renderMeetings();
  } catch (err) {
    meetingsContainer.innerHTML = '<p class="error">Failed to load meetings. Make sure backend server is running.</p>';
  }
}

function renderMeetings() {
  const searchTerm = (searchInput?.value || '').toLowerCase().trim();
  const importanceFilter = filterImportance?.value || 'all';

  const filtered = allMeetings.filter(meeting => {
    const matchesSearch = meeting.title.toLowerCase().includes(searchTerm) ||
      (meeting.description || '').toLowerCase().includes(searchTerm) ||
      (meeting.category || '').toLowerCase().includes(searchTerm);
    const matchesImportance = importanceFilter === 'all' || (meeting.importance || 'Medium') === importanceFilter;
    return matchesSearch && matchesImportance;
  });

  if (!filtered.length) {
    meetingsContainer.innerHTML = '<p class="empty">No matching meetings found. Create one or adjust your search filter.</p>';
    return;
  }

  meetingsContainer.innerHTML = filtered.map(meeting => {
    const imp = meeting.importance || 'Medium';
    const cat = meeting.category || 'General';
    const impBadgeClass = imp === 'High' ? 'badge-high' : imp === 'Low' ? 'badge-low' : 'badge-medium';
    // Use the stored link — could be Google Meet, Zoom, Teams, etc.
    const jitsiLink = meeting.meeting_link || '';
    const platform = detectPlatform(jitsiLink);
    const joinBtn = jitsiLink
      ? `<a href="${escapeHtml(jitsiLink)}" target="_blank" rel="noopener noreferrer" class="btn-video btn-ext-join" style="background:${platform.color}">${platform.icon} Join ${platform.name}</a>`
      : '';
    const linkStrip = jitsiLink
      ? `<div class="room-link-strip"><span class="jitsi-logo">${platform.icon}</span><span class="room-link-strip-text">${escapeHtml(jitsiLink)}</span><button class="copy-strip-btn" onclick="copyLinkDirect(event, '${escapeHtml(jitsiLink)}')">Copy</button></div>`
      : '';

    return `
      <article class="meeting-card priority-${imp.toLowerCase()}">
        <div class="card-badges">
          <span class="badge ${impBadgeClass}">${getImportanceIcon(imp)} ${imp} Priority</span>
          <span class="badge badge-category">${escapeHtml(cat)}</span>
        </div>
        <h3>${escapeHtml(meeting.title)}</h3>
        <p>${escapeHtml(meeting.description || 'No description provided.')}</p>
        <div class="meta">
          <span>📅 ${new Date(meeting.starts_at).toLocaleString()}</span>
          <span>👤 Host: ${escapeHtml(meeting.host_name || 'User')} (${meeting.participant_count} participant${meeting.participant_count === 1 ? '' : 's'})</span>
        </div>
        <div class="card-actions">
          <button class="primary" onclick="location.href='meeting.html?id=${meeting.id}'">Open Discussion</button>
          <button class="btn-share" onclick="copyMeetingLink(event, '${escapeHtml(jitsiLink)}')">📋 Copy Invite Link</button>
          ${joinBtn}
        </div>
        ${linkStrip}
      </article>
    `;
  }).join('');
}

function copyMeetingLink(event, jitsiLink) {
  const btn = event.currentTarget;
  if (!jitsiLink) { alert('No video call link for this meeting.'); return; }
  navigator.clipboard.writeText(jitsiLink).then(() => {
    const originalText = btn.innerHTML;
    btn.innerHTML = '✅ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = originalText; btn.classList.remove('copied'); }, 2500);
  }).catch(() => alert(`Video Call Link:\n${jitsiLink}`));
}

function copyLinkDirect(event, link) {
  event.stopPropagation();
  const btn = event.currentTarget;
  navigator.clipboard.writeText(link).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '✅';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  }).catch(() => alert(link));
}

function getImportanceIcon(importance) {
  if (importance === 'High') return '🔴';
  if (importance === 'Low') return '🟢';
  return '🟡';
}

searchInput?.addEventListener('input', renderMeetings);
filterImportance?.addEventListener('change', renderMeetings);

document.querySelector('#meetingForm').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorEl = document.querySelector('#error');
  errorEl.textContent = '';

  // Read the user's own video call link (Google Meet, Zoom, Teams, etc.)
  const userMeetingLink = (form.meetingLink ? form.meetingLink.value.trim() : '') || '';

  const payload = {
    title: form.title.value,
    importance: form.importance.value,
    category: form.category.value,
    startsAt: form.startsAt.value,
    meetingLink: userMeetingLink,
    description: form.description.value
  };

  try {
    const response = await api('/api/meetings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json();
      errorEl.textContent = data.error || 'Failed to create meeting.';
      return;
    }

    modal.hidden = true;
    form.reset();

    // Show the user's own video call link in the success modal
    const platform = detectPlatform(userMeetingLink);
    const linkDisplayEl = document.querySelector('#roomLinkDisplay');
    const roomNoLink = document.querySelector('#roomNoLink');
    const roomLinkIcon = document.querySelector('#roomLinkIcon');
    const roomLinkSubtitle = document.querySelector('#roomLinkSubtitle');

    if (userMeetingLink) {
      generatedRoomLinkEl.textContent = userMeetingLink;
      openRoomBtn.href = userMeetingLink;
      openRoomBtn.style.display = '';
      copyRoomLinkBtn.style.display = '';
      if (linkDisplayEl) linkDisplayEl.style.display = '';
      if (roomNoLink) roomNoLink.style.display = 'none';
      if (roomLinkIcon) roomLinkIcon.textContent = platform.icon;
      if (roomLinkSubtitle) roomLinkSubtitle.innerHTML = `Your <strong>${platform.name}</strong> link is ready — share it with participants:`;
    } else {
      if (linkDisplayEl) linkDisplayEl.style.display = 'none';
      if (roomNoLink) roomNoLink.style.display = '';
      openRoomBtn.style.display = 'none';
      copyRoomLinkBtn.style.display = 'none';
      if (roomLinkSubtitle) roomLinkSubtitle.textContent = 'Meeting created! No video call link was added.';
    }
    roomLinkModal.hidden = false;

    await fetchServerIp();
    loadMeetings();
  } catch (err) {
    errorEl.textContent = 'Server connection error. Please try again.';
  }
};

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]));
}

loadMeetings();