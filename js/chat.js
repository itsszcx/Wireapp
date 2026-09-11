import { supabase } from "./supabase-client.js";
import { state } from "./state.js";
import { showScreen, formatTime, escapeHtml } from "./helpers.js";
import { loadConversations } from "./home.js";

// ---------- Open a chat ----------
export async function openChat(conversation, otherCode) {
  const otherId = conversation.user_a_id === state.currentProfile.id ? conversation.user_b_id : conversation.user_a_id;
  state.activeConversation = { id: conversation.id, otherCode, otherId };
  state.otherLastReadAt = null;
  oldestLoadedAt = null;
  hasMoreOlder = false;
  document.getElementById("chatWithCode").textContent = otherCode;
  showScreen("chatScreen");
  await loadMessages();
  subscribeToMessages();
  await refreshOtherReadState();
  subscribeToReadState();

  // Mark as read + un-hide (in case it was previously deleted-for-me)
  await supabase.from("conversation_state").upsert({
    conversation_id: conversation.id,
    user_id: state.currentProfile.id,
    hidden: false,
    last_read_at: new Date().toISOString()
  }, { onConflict: "conversation_id,user_id" });
}

document.getElementById("backBtn").addEventListener("click", () => {
  if (state.messageChannel) {
    supabase.removeChannel(state.messageChannel);
    state.messageChannel = null;
  }
  if (state.readStateChannel) {
    supabase.removeChannel(state.readStateChannel);
    state.readStateChannel = null;
  }
  state.otherLastReadAt = null;
  state.activeConversation = null;
  showScreen("homeScreen");
  loadConversations();
});

// How many messages to fetch per page. Fetching newest-first (see
// loadMessages below) guarantees the bottom of the chat is always complete,
// even in a long conversation — older messages load on request instead.
const MESSAGE_PAGE_SIZE = 50;
let oldestLoadedAt = null;
let hasMoreOlder = false;

// ---------- Load messages for active conversation ----------
async function loadMessages() {
  const { data: messages, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", state.activeConversation.id)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);

  const container = document.getElementById("messagesEl");
  container.innerHTML = "";

  if (error || !messages) return;

  // We fetched newest-first specifically so the bottom of the chat is
  // guaranteed complete regardless of how long the conversation is — flip
  // back to chronological order for rendering.
  const ordered = messages.slice().reverse();
  hasMoreOlder = messages.length === MESSAGE_PAGE_SIZE;
  oldestLoadedAt = ordered.length ? ordered[0].created_at : null;

  renderLoadEarlierButton();
  for (const m of ordered) renderMessage(m);
  container.scrollTop = container.scrollHeight;
}

// Fetches an older page above what's currently loaded, without disturbing
// the user's scroll position.
async function loadOlderMessages() {
  if (!hasMoreOlder || !oldestLoadedAt || !state.activeConversation) return;
  const container = document.getElementById("messagesEl");
  const btn = document.getElementById("loadEarlierBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }

  const { data: older, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", state.activeConversation.id)
    .lt("created_at", oldestLoadedAt)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);

  if (error || !older) {
    if (btn) { btn.disabled = false; btn.textContent = "Load earlier messages"; }
    return;
  }

  const ordered = older.slice().reverse();
  hasMoreOlder = older.length === MESSAGE_PAGE_SIZE;
  if (ordered.length) oldestLoadedAt = ordered[0].created_at;

  const previousHeight = container.scrollHeight;
  const previousScrollTop = container.scrollTop;

  if (btn) btn.remove();

  const fragment = document.createDocumentFragment();
  for (const m of ordered) fragment.appendChild(buildMessageElement(m));
  container.prepend(fragment);

  renderLoadEarlierButton();
  // Keep whatever the user was looking at in the same spot on screen.
  container.scrollTop = previousScrollTop + (container.scrollHeight - previousHeight);
}

function renderLoadEarlierButton() {
  const container = document.getElementById("messagesEl");
  const existing = document.getElementById("loadEarlierBtn");
  if (existing) existing.remove();
  if (!hasMoreOlder) return;

  const btn = document.createElement("button");
  btn.id = "loadEarlierBtn";
  btn.className = "load-earlier-btn";
  btn.textContent = "Load earlier messages";
  btn.addEventListener("click", loadOlderMessages);
  container.prepend(btn);
}

// Builds a message bubble without appending or scrolling — used both for
// normal (bottom) rendering and for prepending older pages above.
function buildMessageElement(m) {
  const div = document.createElement("div");
  const mine = m.sender_id === state.currentProfile.id;
  div.className = "bubble " + (mine ? "mine" : "theirs");
  div.dataset.messageId = m.id;
  div.dataset.createdAt = m.created_at;

  if (m.type === "image") {
    div.classList.add("image-bubble");
    renderImageBubble(div, m);
  } else {
    div.innerHTML = `${escapeHtml(m.content)}<span class="bubble-time">${formatTime(m.created_at)}</span>`;
    if (mine) {
      const unsendBtn = document.createElement("button");
      unsendBtn.className = "unsend-btn";
      unsendBtn.title = "Unsend";
      unsendBtn.textContent = "×";
      unsendBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Unsend this message? It will be removed for both of you.")) return;
        const { error } = await supabase.from("messages").delete().eq("id", m.id);
        if (!error) div.remove();
      });
      div.appendChild(unsendBtn);
    }
  }

  return div;
}

function renderMessage(m) {
  const container = document.getElementById("messagesEl");
  const div = buildMessageElement(m);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  renderReadReceipt();
}

// ---------- Read receipts ----------
function renderReadReceipt() {
  const container = document.getElementById("messagesEl");
  container.querySelectorAll(".read-receipt").forEach((el) => el.remove());

  const mineBubbles = container.querySelectorAll(".bubble.mine");
  if (mineBubbles.length === 0) return;

  const lastBubble = mineBubbles[mineBubbles.length - 1];
  const createdAt = lastBubble.dataset.createdAt;

  const receipt = document.createElement("div");
  receipt.className = "read-receipt";
  if (state.otherLastReadAt && new Date(state.otherLastReadAt) >= new Date(createdAt)) {
    receipt.textContent = "Read " + formatTime(state.otherLastReadAt);
  } else {
    receipt.textContent = "Delivered";
  }
  lastBubble.insertAdjacentElement("afterend", receipt);
  container.scrollTop = container.scrollHeight;
}

async function refreshOtherReadState() {
  if (!state.activeConversation || !state.activeConversation.otherId) return;
  const { data } = await supabase
    .from("conversation_state")
    .select("last_read_at")
    .eq("conversation_id", state.activeConversation.id)
    .eq("user_id", state.activeConversation.otherId)
    .maybeSingle();
  state.otherLastReadAt = data ? data.last_read_at : null;
  renderReadReceipt();
}

function subscribeToReadState() {
  if (state.readStateChannel) supabase.removeChannel(state.readStateChannel);
  state.readStateChannel = supabase
    .channel("read-state-" + state.activeConversation.id)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "conversation_state",
        filter: `conversation_id=eq.${state.activeConversation.id}`
      },
      (payload) => {
        const row = payload.new;
        if (row && row.user_id === state.activeConversation.otherId) {
          state.otherLastReadAt = row.last_read_at;
          renderReadReceipt();
        }
      }
    )
    .subscribe();
}

// Update an existing message bubble already in the DOM (used for realtime UPDATE events)
function updateMessageInDom(m) {
  const container = document.getElementById("messagesEl");
  const div = container.querySelector(`[data-message-id="${m.id}"]`);
  if (!div || m.type !== "image") return;
  renderImageBubble(div, m);
}

function renderImageBubble(div, m) {
  const mine = m.sender_id === state.currentProfile.id;

  if (!m.disappearing) {
    div.innerHTML = `<img src="${m.image_url}" alt="Photo" /><span class="bubble-time">${formatTime(m.created_at)}</span>`;
    attachLightbox(div, m.image_url);
    return;
  }

  if (m.expired) {
    div.innerHTML = `<div class="expired-photo">📷 Photo expired</div><span class="bubble-time" style="padding-left:20px;">${formatTime(m.created_at)}</span>`;
    return;
  }

  if (!m.viewed_at) {
    if (mine) {
      // The sender can already see what they sent -- opening it themselves
      // must NOT start the disappearing countdown. Only the recipient's
      // first open (via the "Tap to view" cover below) starts the timer.
      div.innerHTML = `<img src="${m.image_url}" alt="Photo" /><span class="bubble-time">${formatTime(m.created_at)} · not opened yet</span>`;
      attachLightbox(div, m.image_url);
    } else {
      div.innerHTML = `<div class="photo-cover">📷 Tap to view<span class="cover-sub">Disappears 30s after opening</span></div>`;
      div.querySelector(".photo-cover").addEventListener("click", () => revealPhoto(m, div));
    }
    return;
  }

  const elapsed = (Date.now() - new Date(m.viewed_at).getTime()) / 1000;
  const remaining = 30 - elapsed;
  if (remaining <= 0) {
    markExpired(m);
    div.innerHTML = `<div class="expired-photo">📷 Photo expired</div>`;
    return;
  }
  showCountdownImage(div, m, remaining);
}

async function revealPhoto(m, div) {
  const { data: updated } = await supabase
    .from("messages")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", m.id)
    .is("viewed_at", null)
    .select()
    .maybeSingle();

  let viewedAt;
  if (updated) {
    viewedAt = updated.viewed_at;
  } else {
    // Someone else already opened it first (race) - use the real value
    const { data: existing } = await supabase
      .from("messages")
      .select("viewed_at, expired")
      .eq("id", m.id)
      .single();
    if (existing && existing.expired) {
      m.expired = true;
      div.innerHTML = `<div class="expired-photo">📷 Photo expired</div>`;
      return;
    }
    viewedAt = existing ? existing.viewed_at : new Date().toISOString();
  }

  m.viewed_at = viewedAt;
  const elapsed = (Date.now() - new Date(viewedAt).getTime()) / 1000;
  const remaining = 30 - elapsed;
  if (remaining <= 0) {
    markExpired(m);
    div.innerHTML = `<div class="expired-photo">📷 Photo expired</div>`;
  } else {
    showCountdownImage(div, m, remaining);
  }
}

function showCountdownImage(div, m, remainingSeconds) {
  const overlayId = "countdown-" + m.id;
  div.innerHTML = `
    <img src="${m.image_url}" alt="Photo" />
    <div class="countdown-overlay" id="${overlayId}">${Math.ceil(remainingSeconds)}s</div>
    <span class="bubble-time">${formatTime(m.created_at)}</span>
  `;
  attachLightbox(div, m.image_url);
  const endTime = Date.now() + remainingSeconds * 1000;

  const interval = setInterval(() => {
    const overlay = document.getElementById(overlayId);
    const secsLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    if (overlay) overlay.textContent = secsLeft + "s";
    if (secsLeft <= 0) {
      clearInterval(interval);
      markExpired(m);
      div.innerHTML = `<div class="expired-photo">📷 Photo expired</div>`;
    }
  }, 1000);
}

async function markExpired(m) {
  if (m.expired) return;
  m.expired = true;

  // Mark expired first -- if the row-delete below ever fails (e.g. a dropped
  // connection), this keeps things safe by showing "expired" instead of a
  // broken image next time the message is loaded.
  await supabase
    .from("messages")
    .update({ expired: true })
    .eq("id", m.id)
    .eq("expired", false);

  try {
    const url = new URL(m.image_url);
    const marker = "/chat-images/";
    const idx = url.pathname.indexOf(marker);
    if (idx !== -1) {
      const path = decodeURIComponent(url.pathname.substring(idx + marker.length));
      await supabase.storage.from("chat-images").remove([path]);
    }
  } catch (e) {
    // best-effort cleanup, ignore failures
  }

  // Fully remove the message from the database -- disappearing means gone for good
  await supabase.from("messages").delete().eq("id", m.id);
}

// ---------- Click-to-enlarge lightbox ----------
function attachLightbox(div, src) {
  const img = div.querySelector("img");
  if (img) {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox(src);
    });
  }
}

function openLightbox(src) {
  document.getElementById("lightboxImg").src = src;
  document.getElementById("lightboxOverlay").classList.add("active");
}

function closeLightbox() {
  document.getElementById("lightboxOverlay").classList.remove("active");
  document.getElementById("lightboxImg").src = "";
}

document.getElementById("lightboxOverlay").addEventListener("click", closeLightbox);

// ---------- Realtime subscription ----------
function subscribeToMessages() {
  if (state.messageChannel) {
    supabase.removeChannel(state.messageChannel);
  }
  state.messageChannel = supabase
    .channel("messages-" + state.activeConversation.id)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${state.activeConversation.id}`
      },
      (payload) => {
        renderMessage(payload.new);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${state.activeConversation.id}`
      },
      (payload) => {
        updateMessageInDom(payload.new);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${state.activeConversation.id}`
      },
      (payload) => {
        const container = document.getElementById("messagesEl");
        const div = container.querySelector(`[data-message-id="${payload.old.id}"]`);
        if (!div) return;
        if (div.classList.contains("image-bubble")) {
          div.innerHTML = `<div class="expired-photo">📷 Photo expired</div>`;
        } else {
          div.remove();
        }
      }
    )
    .subscribe();
}

// ---------- Send message ----------
async function sendMessage() {
  const input = document.getElementById("messageInput");
  const content = input.value.trim();
  if (!content || !state.activeConversation) return;
  input.value = "";

  const { error } = await supabase.from("messages").insert({
    conversation_id: state.activeConversation.id,
    sender_id: state.currentProfile.id,
    content: content
  });
  if (error) {
    alert("Message failed to send: " + error.message);
  }
}

document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// ---------- Send a photo ----------
const attachBtn = document.getElementById("attachBtn");
const imageInput = document.getElementById("imageInput");
const disappearingToggleBtn = document.getElementById("disappearingToggleBtn");

disappearingToggleBtn.addEventListener("click", () => {
  state.sendDisappearing = !state.sendDisappearing;
  disappearingToggleBtn.textContent = state.sendDisappearing ? "🔥 On" : "🔥 Off";
  disappearingToggleBtn.classList.toggle("active", state.sendDisappearing);
});

attachBtn.addEventListener("click", () => {
  if (!state.activeConversation) return;
  imageInput.click();
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files[0];
  imageInput.value = ""; // reset so the same file can be picked again later
  if (!file || !state.activeConversation) return;

  if (!file.type.startsWith("image/")) {
    alert("Please choose an image file.");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    alert("Image is too large (max 8MB).");
    return;
  }

  attachBtn.disabled = true;
  attachBtn.textContent = "…";

  try {
    const ext = file.name.split(".").pop();
    const path = `${state.currentProfile.id}/${state.activeConversation.id}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("chat-images")
      .upload(path, file);
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from("chat-images")
      .getPublicUrl(path);

    const { error: insertError } = await supabase.from("messages").insert({
      conversation_id: state.activeConversation.id,
      sender_id: state.currentProfile.id,
      content: "",
      type: "image",
      image_url: publicUrlData.publicUrl,
      disappearing: state.sendDisappearing
    });
    if (insertError) throw insertError;
  } catch (err) {
    alert("Photo failed to send: " + err.message);
  } finally {
    attachBtn.disabled = false;
    attachBtn.textContent = "📷";
  }
});
