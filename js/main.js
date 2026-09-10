import { supabase } from "./supabase-client.js";
import { showScreen } from "./helpers.js";
import { loadSessionAndGo } from "./auth.js";

// Importing these registers their event listeners (attachBtn, sendBtn,
// backBtn, etc.) even though we don't use their exports directly here.
import "./home.js";
import "./chat.js";
import "./theme.js";

(async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await loadSessionAndGo();
  } else {
    showScreen("authScreen");
  }
})();
