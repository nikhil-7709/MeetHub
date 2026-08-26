const getApiUrl = (path) => {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (window.location.port !== '3000') {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:3000${path}`;
  }
  return path;
};

document.querySelector('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector('#error');
  error.textContent = '';

  try {
    const response = await fetch(getApiUrl('/api/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.value,
        email: form.email.value,
        password: form.password.value
      })
    });
    const data = await response.json();
    if (!response.ok) {
      error.textContent = data.error || 'Failed to create account.';
      return;
    }
    if (data.token && data.user) {
      localStorage.setItem('meetingToken', data.token);
      localStorage.setItem('meetingUser', JSON.stringify(data.user));
      const redirectId = localStorage.getItem('redirectMeeting');
      if (redirectId) {
        localStorage.removeItem('redirectMeeting');
        location.href = `meeting.html?id=${redirectId}`;
      } else {
        location.href = 'dashboard.html';
      }
    } else {
      location.href = 'index.html';
    }
  } catch (err) {
    error.textContent = 'Cannot connect to server. Make sure backend is running.';
  }
});