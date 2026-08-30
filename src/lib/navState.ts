// Minimal module-level navigation state.
// Used to prevent stacked "Save a Spot" modals: save.tsx marks itself open
// on mount; HomeScreen checks the flag before pushing another instance.
// (usePathname in an unfocused tab screen isn't reliable for this.)
export const navState = {
  saveOpen: false,
};
