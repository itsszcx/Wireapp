// A single shared, mutable state object. Modules import `state` and mutate
// its properties directly (rather than reassigning the export itself) so
// every module always sees the current values.
export const state = {
  currentUser: null,       // supabase auth user
  currentProfile: null,    // row from profiles table
  isSignUpMode: false,
  activeConversation: null, // { id, otherCode, otherId }
  messageChannel: null,
  homeChannel: null,
  readStateChannel: null,
  otherLastReadAt: null,
  sendDisappearing: false
};
