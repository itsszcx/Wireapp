import { supabase } from "./supabase-client.js";
import { state } from "./state.js";
import { showScreen, generateCode } from "./helpers.js";
import { loadConversations, subscribeToHomeUpdates } from "./home.js";

const authTitle = document.getElementById("authTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const switchPrompt = document.getElementById("switchPrompt");
const switchModeBtn = document.getElementById("switchModeBtn");
const usernameLabel = document.getElementById("usernameLabel");
const authUsername = document.getElementById("authUsername");
const authError = document.getElementById("authError");

switchModeBtn.addEventListener("click", () => {
  state.isSignUpMode = !state.isSignUpMode;
  authError.textContent = "";
  if (state.isSignUpMode) {
    authTitle.textContent = "Create an account";
    authSubmitBtn.textContent = "Sign up";
    switchPrompt.textContent = "Already have an account?";
    switchModeBtn.textContent = "Sign in";
    usernameLabel.style.display = "block";
    authUsername.style.display = "block";
  } else {
    authTitle.textContent = "Sign in";
    authSubmitBtn.textContent = "Sign in";
    switchPrompt.textContent = "Don't have an account?";
    switchModeBtn.textContent = "Sign up";
    usernameLabel.style.display = "none";
    authUsername.style.display = "none";
  }
});

authSubmitBtn.addEventListener("click", async () => {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  authError.textContent = "";

  if (!email || !password) {
    authError.textContent = "Enter an email and password.";
    return;
  }

  authSubmitBtn.disabled = true;

  try {
    if (state.isSignUpMode) {
      const username = authUsername.value.trim() || email.split("@")[0];
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      // If email confirmation is off, session exists right away
      const user = data.user;
      if (!user) throw new Error("Check your email to confirm your account, then sign in.");

      // Create the profile row with a unique code
      let code = generateCode();
      let attempts = 0;
      let inserted = false;
      while (attempts < 5 && !inserted) {
        const { error: profileError } = await supabase.from("profiles").insert({
          id: user.id,
          username: username,
          unique_code: code
        });
        if (!profileError) {
          inserted = true;
        } else if (profileError.message.includes("duplicate")) {
          code = generateCode();
          attempts++;
        } else {
          throw profileError;
        }
      }
      if (!inserted) throw new Error("Could not generate a unique code, try again.");

      await loadSessionAndGo();
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await loadSessionAndGo();
    }
  } catch (err) {
    authError.textContent = err.message || "Something went wrong.";
  } finally {
    authSubmitBtn.disabled = false;
  }
});

// ---------- Load session / profile, then show home ----------
export async function loadSessionAndGo() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { showScreen("authScreen"); return; }
  state.currentUser = user;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    authError.textContent = "Could not load your profile.";
    return;
  }
  state.currentProfile = profile;
  document.getElementById("yourCode").textContent = profile.unique_code;
  showScreen("homeScreen");
  loadConversations();
  subscribeToHomeUpdates();
}
