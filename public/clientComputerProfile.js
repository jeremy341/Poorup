// Opens a computer player's public profile. The page is the normal profile page, filled from the computer's own record, so search results
// and the profile stay in step. Computer players have no friends, rankings or privacy settings, so only the record is fetched.
let deps = { emit: () => {}, showProfile: () => {}, notice: () => {} };

export function configureComputerProfile(hooks) {
  deps = { ...deps, ...hooks };
}

export function openComputerProfile(personaId) {
  deps.emit("get-computer-profile", { personaId }, (response) => {
    if (response?.success === false || !response?.profile) {
      deps.notice(response?.error || "Computer player could not be opened.");
      return;
    }
    const { profile } = response;
    deps.showProfile({
      id: profile.id,
      name: profile.name,
      difficulty: profile.difficulty,
      gamesPlayed: Number(profile.gamesPlayed) || 0,
      wins: Number(profile.wins) || 0,
      unlockedIds: new Set((Array.isArray(profile.unlocked) ? profile.unlocked : []).map(entry => entry.achievementId)),
      matches: Array.isArray(response.matches) ? response.matches : [],
    });
  });
}
