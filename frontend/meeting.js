const token = localStorage.getItem('meetingToken');
if (!token) { location.href = 'index.html'; }

const meetingId = new URLSearchParams(location.search).get('id');
if (!meetingId) { location.href = 'dashboard.html'; }

const userObj = JSON.parse(localStorage.getItem('meetingUser') || '{"id":0,"name":"Participant"}');
const userId = userObj.id || Math.floor(Math.random() * 10000);

// Detects which video platform a link belongs to
function detectPlatformInRoom(url) {
  if (!url) return { name: 'Video Call', icon: '📹', color: '#1f6956' };
  if (url.includes('meet.google.com'))   return { name: 'Google Meet',    icon: '🟢', color: '#34a853' };
  if (url.includes('zoom.us'))           return { name: 'Zoom',           icon: '📹', color: '#2d8cff' };
  if (url.includes('teams.microsoft'))   return { name: 'Microsoft Teams', icon: '💬', color: '#5b5fc7' };
  if (url.includes('webex.com'))         return { name: 'Webex',          icon: '🌐', color: '#00ade5' };
  if (url.includes('whereby.com'))       return { name: 'Whereby',        icon: '🎥', color: '#4b37b7' };
  if (url.includes('meet.jit.si'))       return { name: 'Jitsi Meet',     icon: '📹', color: '#0098a0' };
  if (url.includes('gotomeeting.com'))   return { name: 'GoToMeeting',    icon: '📞', color: '#ed7d31' };
  return { name: 'Video Call', icon: '🔗', color: '#1f6956' };
}


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

// Real LAN IP for cross-device invite links
let serverBaseUrl = window.location.origin; // fallback until fetched
async function fetchServerIp() {
  try {
    const res = await fetch(getApiUrl('/api/server-info'));
    if (res.ok) {
      const { ip, port } = await res.json();
      if (ip && ip !== 'localhost') {
        serverBaseUrl = `http://${ip}:${port}`;
      }
    }
  } catch (e) { /* stay with origin fallback */ }
}

document.querySelector('#logout').onclick = () => {
  localStorage.clear();
  location.href = 'index.html';
};

// State Variables
let localStream = null;
let isCamOn = true;
let isMicOn = true;
let isHandRaised = false;
let isScreenSharing = false;
let signalingInterval = null;
let videoCallStarted = false;
let lastSignalTime = 0;
let roomSeconds = 0;
let roomTimerInterval = null;
const peerConnections = new Map(); // peerId -> RTCPeerConnection
const activeParticipants = new Map(); // peerId -> { name, isHost, isMicOn, isCamOn, isHandRaised }

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// DOM Elements
const videoCallPanel = document.querySelector('#videoCallPanel');
const videoGrid = document.querySelector('#videoGrid');
const localVideo = document.querySelector('#localVideo');
const localUserName = document.querySelector('#localUserName');
const localHandBadge = document.querySelector('#localHandBadge');
const localMicIcon = document.querySelector('#localMicIcon');

const btnToggleCam = document.querySelector('#btnToggleCam');
const btnToggleMic = document.querySelector('#btnToggleMic');
const btnShareScreen = document.querySelector('#btnShareScreen');
const btnRaiseHand = document.querySelector('#btnRaiseHand');
const btnLeaveCall = document.querySelector('#btnLeaveCall');
const btnFullscreen = document.querySelector('#btnFullscreen');

const sidebar = document.querySelector('#sidebar');
const btnToggleSidebarChat = document.querySelector('#btnToggleSidebarChat');
const btnToggleSidebarPeople = document.querySelector('#btnToggleSidebarPeople');
const closeSidebarBtn = document.querySelector('#closeSidebarBtn');
const tabChatBtn = document.querySelector('#tabChatBtn');
const tabPeopleBtn = document.querySelector('#tabPeopleBtn');
const panelChat = document.querySelector('#panelChat');
const panelPeople = document.querySelector('#panelPeople');
const peopleList = document.querySelector('#peopleList');
const msgCountEl = document.querySelector('#msgCount');
const peopleCountEl = document.querySelector('#peopleCount');

const handToast = document.querySelector('#handToast');
const toastMessage = document.querySelector('#toastMessage');
const roomTimer = document.querySelector('#roomTimer');

localUserName.textContent = `${userObj.name} (You)`;
activeParticipants.set(userId, { name: userObj.name, isHost: true, isMicOn: true, isCamOn: true, isHandRaised: false });

async function load() {
  try {
    const response = await api(`/api/meetings/${meetingId}`);
    if (response.status === 401) {
      if (meetingId) localStorage.setItem('redirectMeeting', meetingId);
      return location.href = 'index.html';
    }
    if (!response.ok) {
      document.querySelector('#error').textContent = (await response.json()).error;
      return;
    }
    const data = await response.json();
    const m = data.meeting;

    document.querySelector('#title').textContent = m.title;

    const imp = m.importance || 'Medium';
    const cat = m.category || 'General';
    const impBadgeClass = imp === 'High' ? 'badge-high' : imp === 'Low' ? 'badge-low' : 'badge-medium';
    const impIcon = imp === 'High' ? '🔴' : imp === 'Low' ? '🟢' : '🟡';

    document.querySelector('#headerBadges').innerHTML = `
      <span class="badge ${impBadgeClass}">${impIcon} ${imp} Priority</span>
      <span class="badge badge-category">${escapeHtml(cat)}</span>
    `;

    document.querySelector('#details').textContent =
      `📅 ${new Date(m.starts_at).toLocaleString()} · Hosted by ${m.host_name} ${m.description ? `· ${m.description}` : ''}`;

    const container = document.querySelector('#videoActionContainer');
    if (m.meeting_link && !container.querySelector('.btn-video')) {
      const platform = detectPlatformInRoom(m.meeting_link);
      const linkBtn = document.createElement('a');
      linkBtn.href = m.meeting_link;
      linkBtn.target = '_blank';
      linkBtn.rel = 'noopener noreferrer';
      linkBtn.className = 'btn-video';
      linkBtn.style.cssText = `margin-right:10px;background:${platform.color};color:#fff;`;
      linkBtn.textContent = `${platform.icon} Join ${platform.name}`;
      container.prepend(linkBtn);
    }

    // Populate the in-call link banner with the real Jitsi Meet link
    const roomLinkDisplay = document.querySelector('#roomLinkDisplay');
    const copyRoomLinkInCall = document.querySelector('#copyRoomLinkInCall');
    const openJitsiBtn = document.querySelector('#openJitsiBtn');
    if (roomLinkDisplay) {
      if (m.meeting_link) {
        roomLinkDisplay.textContent = m.meeting_link;
        if (openJitsiBtn) { openJitsiBtn.href = m.meeting_link; openJitsiBtn.style.display = ''; }
        if (copyRoomLinkInCall) {
          copyRoomLinkInCall.onclick = () => {
            navigator.clipboard.writeText(m.meeting_link).then(() => {
              const orig = copyRoomLinkInCall.innerHTML;
              copyRoomLinkInCall.innerHTML = '✅ Copied!';
              copyRoomLinkInCall.classList.add('copied');
              setTimeout(() => { copyRoomLinkInCall.innerHTML = orig; copyRoomLinkInCall.classList.remove('copied'); }, 2500);
            }).catch(() => alert(`Video Call Link:\n${m.meeting_link}`));
          };
        }
      } else {
        roomLinkDisplay.textContent = 'No video call link for this meeting';
        if (copyRoomLinkInCall) copyRoomLinkInCall.style.display = 'none';
      }
    }

    // Render Messages
    renderMessages(data.messages || []);
    renderPeopleList();

    // Auto-start camera and call session (only once)
    if (!videoCallStarted) {
      videoCallStarted = true;
      startVideoCall();
    }

  } catch (err) {
    document.querySelector('#error').textContent = 'Error loading meeting details.';
  }
}

function renderMessages(messages) {
  msgCountEl.textContent = messages.length;
  const msgList = document.querySelector('#messages');
  msgList.innerHTML = messages.length
    ? messages.map(message => `
        <div class="message ${message.user_id === userId ? 'my-message' : ''}">
          <b>${escapeHtml(message.name)}</b>
          <time>${new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          <div>${escapeHtml(message.body)}</div>
        </div>
      `).join('')
    : '<p class="empty">No messages yet. Start the conversation.</p>';
  // Always scroll to the latest message
  msgList.scrollTop = msgList.scrollHeight;
}

function renderPeopleList() {
  peopleCountEl.textContent = activeParticipants.size;
  peopleList.innerHTML = Array.from(activeParticipants.values()).map(p => `
    <div class="person-item">
      <div class="person-info">
        <span class="person-avatar">${p.name.charAt(0).toUpperCase()}</span>
        <span class="person-name">${escapeHtml(p.name)} ${p.name === userObj.name ? '(You)' : ''}</span>
      </div>
      <div class="person-status">
        ${p.isHandRaised ? '<span title="Hand Raised">✋</span>' : ''}
        <span>${p.isMicOn ? '🎙️' : '🔇'}</span>
        <span>${p.isCamOn ? '📷' : '🚫'}</span>
      </div>
    </div>
  `).join('');
}

// ----------------------------------------------------
// WEBRTC & CAMERA LOGIC
// ----------------------------------------------------

async function startVideoCall() {
  try {
    // 1. Get Camera Stream
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    startRoomTimer();

    // 2. Broadcast 'join' signal
    await sendSignal(null, 'join', { senderName: userObj.name });

    // 3. Start Signal Polling
    lastSignalTime = Date.now() - 5000;
    signalingInterval = setInterval(pollSignals, 1500);

  } catch (err) {
    console.warn('Camera access fallback (mic or video disabled):', err);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startRoomTimer();
      await sendSignal(null, 'join', { senderName: userObj.name });
      signalingInterval = setInterval(pollSignals, 1500);
    } catch (e) {
      console.error('No media devices available:', e);
    }
  }
}

function startRoomTimer() {
  if (roomTimerInterval) clearInterval(roomTimerInterval);
  roomSeconds = 0;
  roomTimerInterval = setInterval(() => {
    roomSeconds++;
    const mins = String(Math.floor(roomSeconds / 60)).padStart(2, '0');
    const secs = String(roomSeconds % 60).padStart(2, '0');
    roomTimer.textContent = `${mins}:${secs}`;
  }, 1000);
}

async function sendSignal(targetId, type, payload) {
  try {
    await api(`/api/meetings/${meetingId}/signal`, {
      method: 'POST',
      body: JSON.stringify({ targetId, type, payload })
    });
  } catch (err) {
    console.error('Failed to send signal:', err);
  }
}

async function pollSignals() {
  try {
    const res = await api(`/api/meetings/${meetingId}/signal?since=${lastSignalTime}`);
    if (!res.ok) return;

    const data = await res.json();
    if (data.now) lastSignalTime = data.now;

    for (const sig of data.signals) {
      handleIncomingSignal(sig);
    }
  } catch (err) {
    console.error('Error polling signals:', err);
  }
}

async function handleIncomingSignal(sig) {
  const { senderId, senderName, type, payload } = sig;

  // Track active participant
  if (!activeParticipants.has(senderId)) {
    activeParticipants.set(senderId, { name: senderName, isHost: false, isMicOn: true, isCamOn: true, isHandRaised: false });
    renderPeopleList();
  }

  if (type === 'join') {
    const pc = createPeerConnection(senderId, senderName);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal(senderId, 'offer', offer);
  } else if (type === 'offer') {
    const pc = createPeerConnection(senderId, senderName);
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal(senderId, 'answer', answer);
  } else if (type === 'answer') {
    const pc = peerConnections.get(senderId);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(payload));
  } else if (type === 'candidate') {
    const pc = peerConnections.get(senderId);
    if (pc && payload) {
      try { await pc.addIceCandidate(new RTCIceCandidate(payload)); } catch (e) {}
    }
  } else if (type === 'raise-hand') {
    const p = activeParticipants.get(senderId);
    if (p) p.isHandRaised = payload.isHandRaised;
    renderPeopleList();

    const remoteHand = document.querySelector(`#peer-hand-${senderId}`);
    if (remoteHand) remoteHand.hidden = !payload.isHandRaised;

    if (payload.isHandRaised) {
      showToast(`✋ ${senderName} raised hand!`);
    }
  } else if (type === 'media-state') {
    const p = activeParticipants.get(senderId);
    if (p) {
      p.isMicOn = payload.isMicOn;
      p.isCamOn = payload.isCamOn;
      renderPeopleList();

      const remoteMic = document.querySelector(`#peer-mic-${senderId}`);
      if (remoteMic) remoteMic.textContent = payload.isMicOn ? '🎙️' : '🔇';
    }
  } else if (type === 'leave') {
    removePeer(senderId);
  }
}

function createPeerConnection(peerId, peerName) {
  if (peerConnections.has(peerId)) return peerConnections.get(peerId);

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(peerId, pc);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal(peerId, 'candidate', event.candidate);
  };

  pc.ontrack = (event) => {
    let remoteVideoCard = document.querySelector(`#peer-card-${peerId}`);
    if (!remoteVideoCard) {
      remoteVideoCard = document.createElement('div');
      remoteVideoCard.className = 'video-card remote-card';
      remoteVideoCard.id = `peer-card-${peerId}`;

      remoteVideoCard.innerHTML = `
        <video id="peer-video-${peerId}" autoplay playsinline></video>
        <div class="video-overlay">
          <span class="user-name">${escapeHtml(peerName)}</span>
          <span class="user-indicators">
            <span class="hand-badge" id="peer-hand-${peerId}" hidden>✋</span>
            <span class="mic-status" id="peer-mic-${peerId}">🎙️</span>
          </span>
        </div>
      `;
      videoGrid.appendChild(remoteVideoCard);
    }

    const videoEl = remoteVideoCard.querySelector('video');
    if (videoEl && event.streams[0]) videoEl.srcObject = event.streams[0];
  };

  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      removePeer(peerId);
    }
  };

  return pc;
}

function removePeer(peerId) {
  if (peerConnections.has(peerId)) {
    peerConnections.get(peerId).close();
    peerConnections.delete(peerId);
  }
  activeParticipants.delete(peerId);
  renderPeopleList();

  const peerCard = document.querySelector(`#peer-card-${peerId}`);
  if (peerCard) peerCard.remove();
}

function showToast(msg) {
  toastMessage.textContent = msg;
  handToast.hidden = false;
  setTimeout(() => { handToast.hidden = true; }, 3500);
}

// ----------------------------------------------------
// TOOLBAR ACTIONS
// ----------------------------------------------------

btnToggleCam.onclick = () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    isCamOn = !isCamOn;
    videoTrack.enabled = isCamOn;
    document.querySelector('#camBtnLabel').textContent = isCamOn ? 'Cam On' : 'Cam Off';
    btnToggleCam.classList.toggle('btn-off', !isCamOn);
    broadcastMediaState();
  }
};

btnToggleMic.onclick = () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    isMicOn = !isMicOn;
    audioTrack.enabled = isMicOn;
    document.querySelector('#micBtnLabel').textContent = isMicOn ? 'Mic On' : 'Mic Off';
    localMicIcon.textContent = isMicOn ? '🎙️' : '🔇';
    btnToggleMic.classList.toggle('btn-off', !isMicOn);
    broadcastMediaState();
  }
};

async function broadcastMediaState() {
  activeParticipants.get(userId).isMicOn = isMicOn;
  activeParticipants.get(userId).isCamOn = isCamOn;
  renderPeopleList();
  await sendSignal(null, 'media-state', { isMicOn, isCamOn });
}

btnRaiseHand.onclick = async () => {
  isHandRaised = !isHandRaised;
  localHandBadge.hidden = !isHandRaised;
  document.querySelector('#handBtnLabel').textContent = isHandRaised ? 'Lower Hand' : 'Raise Hand';
  btnRaiseHand.classList.toggle('active', isHandRaised);

  activeParticipants.get(userId).isHandRaised = isHandRaised;
  renderPeopleList();

  if (isHandRaised) showToast('✋ You raised your hand');
  await sendSignal(null, 'raise-hand', { isHandRaised });
};

btnShareScreen.onclick = async () => {
  if (isScreenSharing) {
    stopScreenSharing();
    return;
  }
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];

    peerConnections.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });

    localVideo.srcObject = screenStream;
    isScreenSharing = true;
    btnShareScreen.classList.add('active');

    screenTrack.onended = stopScreenSharing;
  } catch (err) {
    console.error('Screen sharing canceled:', err);
  }
};

function stopScreenSharing() {
  if (!isScreenSharing) return;
  const videoTrack = localStream?.getVideoTracks()[0];
  peerConnections.forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender && videoTrack) sender.replaceTrack(videoTrack);
  });
  localVideo.srcObject = localStream;
  isScreenSharing = false;
  btnShareScreen.classList.remove('active');
}

btnFullscreen.onclick = () => {
  if (!document.fullscreenElement) {
    videoCallPanel.requestFullscreen().catch(err => console.error(err));
  } else {
    document.exitFullscreen();
  }
};

btnLeaveCall.onclick = async () => {
  if (confirm('Leave this meeting call?')) {
    if (signalingInterval) clearInterval(signalingInterval);
    if (roomTimerInterval) clearInterval(roomTimerInterval);

    await sendSignal(null, 'leave', {});

    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();

    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }

    location.href = 'dashboard.html';
  }
};

// ----------------------------------------------------
// SIDEBAR & TAB SWITCHING
// ----------------------------------------------------

btnToggleSidebarChat.onclick = () => {
  sidebar.classList.toggle('open');
  switchTab('chat');
};

btnToggleSidebarPeople.onclick = () => {
  sidebar.classList.toggle('open');
  switchTab('people');
};

closeSidebarBtn.onclick = () => sidebar.classList.remove('open');

tabChatBtn.onclick = () => switchTab('chat');
tabPeopleBtn.onclick = () => switchTab('people');

function switchTab(tab) {
  if (tab === 'chat') {
    tabChatBtn.classList.add('active');
    tabPeopleBtn.classList.remove('active');
    panelChat.classList.add('active');
    panelPeople.classList.remove('active');
  } else {
    tabPeopleBtn.classList.add('active');
    tabChatBtn.classList.remove('active');
    panelPeople.classList.add('active');
    panelChat.classList.remove('active');
  }
}

// Share Meeting Link — uses real LAN IP so other devices can open it
const shareMeetingBtn = document.querySelector('#shareMeetingBtn');
if (shareMeetingBtn) {
  shareMeetingBtn.onclick = () => {
    const meetingUrl = `${serverBaseUrl}/meeting.html?id=${meetingId}`;
    navigator.clipboard.writeText(meetingUrl).then(() => {
      const originalText = shareMeetingBtn.innerHTML;
      shareMeetingBtn.innerHTML = '✅ Copied!';
      shareMeetingBtn.classList.add('copied');
      setTimeout(() => {
        shareMeetingBtn.innerHTML = originalText;
        shareMeetingBtn.classList.remove('copied');
      }, 2500);
    }).catch(() => {
      alert(`Share this link with others:\n${meetingUrl}`);
    });
  };
}

// Chat Form Submit — only refreshes messages, does NOT restart video call
document.querySelector('#messageForm').onsubmit = async (event) => {
  event.preventDefault();
  const input = document.querySelector('#body');
  const errorEl = document.querySelector('#error');
  errorEl.textContent = '';

  const trimmed = input.value.trim();
  if (!trimmed) return;

  const response = await api(`/api/meetings/${meetingId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: trimmed })
  });
  if (!response.ok) {
    errorEl.textContent = (await response.json()).error;
    return;
  }
  input.value = '';

  // Only refresh the messages list — never restart the video call
  try {
    const res = await api(`/api/meetings/${meetingId}`);
    if (res.ok) {
      const data = await res.json();
      renderMessages(data.messages || []);
      // Scroll to bottom of messages
      const msgList = document.querySelector('#messages');
      if (msgList) msgList.scrollTop = msgList.scrollHeight;
    }
  } catch (e) {
    console.error('Failed to refresh messages:', e);
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

// Fetch real network IP first, then load meeting
fetchServerIp().then(() => load());


