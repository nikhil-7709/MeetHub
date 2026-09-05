const getApiUrl = (path) => {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (window.location.protocol === 'file:' ||
      ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '3000') {
    return `http://localhost:3000${path}`;
  }
  return path;
};

const loginForm = document.querySelector('#loginForm');
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('#error');
  error.textContent = '';

  const emailInput = document.querySelector('#email');
  const passwordInput = document.querySelector('#password');

  try {
    const response = await fetch(getApiUrl('/api/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput.value, password: passwordInput.value })
    });
    const data = await response.json();
    if (!response.ok) {
      error.textContent = data.error || 'Failed to sign in. Please check your credentials.';
      return;
    }
    localStorage.setItem('meetingToken', data.token);
    localStorage.setItem('meetingUser', JSON.stringify(data.user));
    const redirectId = localStorage.getItem('redirectMeeting');
    if (redirectId) {
      localStorage.removeItem('redirectMeeting');
      location.href = `meeting.html?id=${redirectId}`;
    } else {
      location.href = 'dashboard.html';
    }
  } catch (err) {
    error.textContent = 'Cannot connect to server. Make sure backend is running.';
  }
});
