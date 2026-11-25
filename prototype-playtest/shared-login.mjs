import { arenaRequest } from './shared-client.mjs';

const form = document.getElementById('login');
const username = document.getElementById('username');
const button = form.querySelector('button');
const notice = document.getElementById('login-notice');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  notice.textContent = '';
  try {
    await arenaRequest('login', { username: username.value });
    location.replace('/arena/');
  } catch (error) {
    notice.textContent = error.message;
    button.disabled = false;
  }
});
