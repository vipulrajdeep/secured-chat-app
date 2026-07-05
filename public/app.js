const state = {
  username: "",
  conversations: [],
  activeConversationId: "",
  events: null,
  poll: null
};

const elements = {
  identityForm: document.querySelector("#identityForm"),
  username: document.querySelector("#username"),
  conversationForm: document.querySelector("#conversationForm"),
  participants: document.querySelector("#participants"),
  conversationName: document.querySelector("#conversationName"),
  conversationList: document.querySelector("#conversationList"),
  chatTitle: document.querySelector("#chatTitle"),
  chatMeta: document.querySelector("#chatMeta"),
  messages: document.querySelector("#messages"),
  messageForm: document.querySelector("#messageForm"),
  messageText: document.querySelector("#messageText"),
  status: document.querySelector("#status")
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function setStatus(online) {
  elements.status.textContent = online ? "Online" : "Offline";
  elements.status.classList.toggle("online", online);
}

function conversationTitle(conversation) {
  if (conversation.name) return conversation.name;
  return conversation.participants.filter((name) => name !== state.username).join(", ");
}

function renderConversations() {
  if (!state.username) {
    elements.conversationList.innerHTML = `<p class="empty">Enter a username to load chats.</p>`;
    return;
  }
  if (!state.conversations.length) {
    elements.conversationList.innerHTML = `<p class="empty">No conversations yet.</p>`;
    return;
  }

  elements.conversationList.innerHTML = state.conversations.map((conversation) => `
    <button class="conversation ${conversation.id === state.activeConversationId ? "active" : ""}" data-id="${conversation.id}">
      <strong>${escapeHtml(conversationTitle(conversation))}</strong>
      <span>${escapeHtml(conversation.participants.join(", "))}</span>
    </button>
  `).join("");
}

function renderMessages(messages = []) {
  if (!state.activeConversationId) {
    elements.messages.innerHTML = `<p class="empty">Pick a conversation to begin.</p>`;
    return;
  }
  if (!messages.length) {
    elements.messages.innerHTML = `<p class="empty">No messages here yet.</p>`;
    return;
  }

  elements.messages.innerHTML = messages.map((message) => {
    const mine = message.sender === state.username;
    return `
      <article class="message ${mine ? "mine" : "theirs"}">
        <strong>${escapeHtml(message.sender)}</strong>
        <p>${escapeHtml(message.text)}</p>
        <time>${new Date(message.createdAt).toLocaleString()}</time>
      </article>
    `;
  }).join("");
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

async function loadConversations() {
  if (!state.username) return;
  const data = await api(`/api/conversations?username=${encodeURIComponent(state.username)}`);
  state.conversations = data.conversations;
  if (state.activeConversationId && !state.conversations.some((item) => item.id === state.activeConversationId)) {
    state.activeConversationId = "";
  }
  renderConversations();
}

async function loadMessages() {
  if (!state.activeConversationId || !state.username) {
    renderMessages();
    return;
  }
  const data = await api(`/api/conversations/${state.activeConversationId}/messages?username=${encodeURIComponent(state.username)}`);
  elements.chatTitle.textContent = conversationTitle(data.conversation);
  elements.chatMeta.textContent = data.conversation.participants.join(", ");
  renderMessages(data.messages);
}

async function refresh() {
  try {
    await loadConversations();
    await loadMessages();
  } catch (error) {
    showError(error.message);
  }
}

function showError(message) {
  const note = document.createElement("p");
  note.className = "toast";
  note.textContent = message;
  elements.messages.prepend(note);
  setTimeout(() => note.remove(), 4000);
}

function connectEvents() {
  if (state.events) state.events.close();
  if (state.poll) clearInterval(state.poll);
  if (!state.username) return;

  state.events = new EventSource(`/api/events?username=${encodeURIComponent(state.username)}`);
  state.events.addEventListener("connected", () => setStatus(true));
  state.events.addEventListener("refresh", refresh);
  state.events.onerror = () => setStatus(false);
  state.poll = setInterval(refresh, 15000);
}

elements.identityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = elements.username.value.trim();
  if (!username) return;
  state.username = username;
  connectEvents();
  await refresh();
});

elements.conversationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.username) return showError("Enter a username first.");
  const participants = elements.participants.value.split(",").map((name) => name.trim()).filter(Boolean);
  const data = await api("/api/conversations", {
    method: "POST",
    body: JSON.stringify({
      username: state.username,
      participants,
      name: elements.conversationName.value.trim()
    })
  });
  elements.participants.value = "";
  elements.conversationName.value = "";
  state.activeConversationId = data.conversation.id;
  await refresh();
});

elements.conversationList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  state.activeConversationId = button.dataset.id;
  renderConversations();
  await loadMessages();
});

elements.messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.username) return showError("Enter a username first.");
  if (!state.activeConversationId) return showError("Choose a conversation first.");
  const text = elements.messageText.value.trim();
  if (!text) return;
  elements.messageText.value = "";
  await api(`/api/conversations/${state.activeConversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ username: state.username, text })
  });
  await refresh();
});

renderConversations();
renderMessages();
