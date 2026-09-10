import { supabase } from "./supabase-client.js";
import { state } from "./state.js";
import { showScreen } from "./helpers.js";
import { openChat } from "./chat.js";

// ---------- Sign out ----------
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  if (state.homeChannel) { supabase.removeChannel(state.homeChannel); state.homeChannel = null; }
  state.currentUser = null;
  state.currentProfile = null;
  showScreen("authScreen");
});

// ---------- Edit display name ----------
document.getElementById("editNameBtn").addEventListener("click", async () => {
  const newName = window.prompt("Your display name:", state.currentProfile.username);
  if (newName === null) return; // cancelled
  const trimmed = newName.trim();
  if (!trimmed || trimmed === state.currentProfile.username) return;

  const { error } = await supabase
    .from("profiles")
    .update({ username: trimmed })
    .eq("id", state.currentProfile.id);

  if (error) {
    alert("Could not update name: " + error.message);
    return;
  }
  state.currentProfile.username = trimmed;
  loadConversations();
});

// ---------- Find / start a conversation ----------
const findBtn = document.getElementById("findBtn");
const findError = document.getElementById("findError");

findBtn.addEventListener("click", async () => {
  const code = document.getElementById("friendCodeInput").value.trim().toUpperCase();
  findError.textContent = "";
  if (!code) return;

  if (code === state.currentProfile.unique_code) {
    findError.textContent = "That's your own code.";
    return;
  }

  const { data: otherProfile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("unique_code", code)
    .single();

  if (error || !otherProfile) {
    findError.textContent = "No user found with that code.";
    return;
  }

  // Check if a conversation already exists between the two users (either direction)
  const { data: existing } = await supabase
    .from("conversations")
    .select("*")
    .or(
      `and(user_a_id.eq.${state.currentProfile.id},user_b_id.eq.${otherProfile.id}),and(user_a_id.eq.${otherProfile.id},user_b_id.eq.${state.currentProfile.id})`
    );

  let conversation;
  if (existing && existing.length > 0) {
    conversation = existing[0];
  } else {
    const { data: created, error: createError } = await supabase
      .from("conversations")
      .insert({ user_a_id: state.currentProfile.id, user_b_id: otherProfile.id })
      .select()
      .single();
    if (createError) {
      findError.textContent = "Could not start chat.";
      return;
    }
    conversation = created;
  }

  document.getElementById("friendCodeInput").value = "";
  openChat(conversation, otherProfile.unique_code);
  loadConversations();
});

// ---------- Load conversation list ----------
export async function loadConversations() {
  const { data: convos, error } = await supabase
    .from("conversations")
    .select("*")
    .or(`user_a_id.eq.${state.currentProfile.id},user_b_id.eq.${state.currentProfile.id}`)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const container = document.getElementById("convoItems");
  container.innerHTML = "";

  if (error || !convos || convos.length === 0) {
    container.innerHTML = `<div class="empty-state">No conversations yet. Enter a code above to start one.</div>`;
    return;
  }

  // Fetch this user's per-conversation state (hidden / last_read_at) in one go
  const { data: convoStates } = await supabase
    .from("conversation_state")
    .select("*")
    .eq("user_id", state.currentProfile.id);

  const stateMap = {};
  for (const s of convoStates || []) stateMap[s.conversation_id] = s;

  let anyVisible = false;

  for (const convo of convos) {
    const convoState = stateMap[convo.id];
    if (convoState && convoState.hidden) continue; // deleted for me
    anyVisible = true;

    const otherId = convo.user_a_id === state.currentProfile.id ? convo.user_b_id : convo.user_a_id;
    const { data: otherProfile } = await supabase
      .from("profiles")
      .select("unique_code, username")
      .eq("id", otherId)
      .single();

    const lastReadAt = convoState ? convoState.last_read_at : "1970-01-01T00:00:00Z";
    const { count: unreadCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", convo.id)
      .neq("sender_id", state.currentProfile.id)
      .gt("created_at", lastReadAt);

    const item = document.createElement("div");
    item.className = "convo-item";
    item.innerHTML = `
      <div>
        <div class="code">${otherProfile ? otherProfile.username : "Unknown"} · ${otherProfile ? otherProfile.unique_code : "??????"}</div>
        <div class="preview">Tap to open</div>
      </div>
      <div class="convo-right">
        ${unreadCount ? `<span class="unread-badge">${unreadCount}</span>` : ""}
        <button class="convo-delete-btn" title="Delete for me">🗑</button>
      </div>
    `;
    item.querySelector(".code").parentElement.addEventListener("click", () =>
      openChat(convo, otherProfile ? otherProfile.unique_code : "??????")
    );
    item.querySelector(".convo-delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this conversation for yourself? The other person will still have it.")) return;
      await supabase.from("conversation_state").upsert({
        conversation_id: convo.id,
        user_id: state.currentProfile.id,
        hidden: true
      }, { onConflict: "conversation_id,user_id" });
      loadConversations();
    });
    container.appendChild(item);
  }

  if (!anyVisible) {
    container.innerHTML = `<div class="empty-state">No conversations yet. Enter a code above to start one.</div>`;
  }
}

// ---------- Keep home screen live: new messages reorder list, bump unread, un-hide ----------
export function subscribeToHomeUpdates() {
  if (state.homeChannel) supabase.removeChannel(state.homeChannel);
  state.homeChannel = supabase
    .channel("home-updates-" + state.currentProfile.id)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      async (payload) => {
        const m = payload.new;
        if (state.activeConversation && state.activeConversation.id === m.conversation_id) return; // already viewing it
        // Un-hide the conversation for the recipient if they'd deleted it before
        if (m.sender_id !== state.currentProfile.id) {
          await supabase.from("conversation_state").upsert({
            conversation_id: m.conversation_id,
            user_id: state.currentProfile.id,
            hidden: false
          }, { onConflict: "conversation_id,user_id" });
        }
        if (document.getElementById("homeScreen").classList.contains("active")) {
          loadConversations();
        }
      }
    )
    .subscribe();
}
