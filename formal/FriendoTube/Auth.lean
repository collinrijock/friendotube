import FriendoTube.Model
/-!
# Authentication, authorization and group-membership theorems

* `auth_required` — every route but signup answers 401 and changes nothing without a valid token.
* `auth_sound` — a token authenticates exactly the stored user whose key hash matches it.
* `handle_runs_as` — an authenticated request runs as that one user.
* `authed_*` — what one user's request can write and read:
  only their own sightings, recs and memberships are created; nobody else's
  sightings, memberships or account are touched; recs go only to their groups;
  joining needs the group's exact invite code; reads only show their groups and
  data from people who share a group with them.
-/
namespace FriendoTube

variable {hash : Str → Str} {s s' : State} {tok : Option Str} {now : Nat} {u : User} {resp : Resp}

/-- A request needs a token unless it is a signup. -/
def Req.needsAuth : Req → Prop
  | .signup .. => False
  | _ => True

theorem auth_sound (h : auth hash s tok = some u) :
    u ∈ s.users ∧ ∃ t, tok = some t ∧ u.tokenHash = hash t := by
  cases tok with
  | none => simp [auth] at h
  | some t =>
    simp only [auth] at h
    refine ⟨List.mem_of_find?_eq_some h, t, rfl, ?_⟩
    simpa using List.find?_some h

/-- **No token, no access.** Without a valid token every route but signup is a 401 and a no-op. -/
theorem auth_required (r : Req) (hr : r.needsAuth) (h : auth hash s tok = none) :
    handle hash s tok now r = (s, .err 401) := by
  cases r <;> simp_all [handle, Req.needsAuth]

/-- An authenticated request is exactly `authed` run as the token's user. -/
theorem handle_runs_as (r : Req) (hr : r.needsAuth) (h : auth hash s tok = some u) :
    handle hash s tok now r = authed s u now r := by
  cases r <;> simp_all [handle, Req.needsAuth]

/-- Any non-signup request either fails with 401 or runs as one authenticated user. -/
theorem handle_cases (r : Req) (hr : r.needsAuth) :
    handle hash s tok now r = (s, .err 401) ∨
    ∃ u, u ∈ s.users ∧ (∃ t, tok = some t ∧ u.tokenHash = hash t) ∧ handle hash s tok now r = authed s u now r := by
  cases h : auth hash s tok with
  | none => exact .inl (auth_required r hr h)
  | some u => exact .inr ⟨u, (auth_sound h).1, (auth_sound h).2, handle_runs_as r hr h⟩

/-! ## Helpers -/

theorem mem_dropEmpty_members {s : State} : (dropEmpty s).members = s.members := rfl
theorem dropEmpty_sightings {s : State} : (dropEmpty s).sightings = s.sightings := rfl
theorem dropEmpty_users {s : State} : (dropEmpty s).users = s.users := rfl

/-! ## Writes: a user only creates their own data -/

/-- New sightings always belong to the requesting user. -/
theorem authed_new_sightings_own (r : Req) (h : (authed s u now r).1 = s') :
    ∀ x ∈ s'.sightings, x ∉ s.sightings → x.user = u.id := by
  subst h
  intro x hx hnot
  cases r with
  | createGroup n c =>
    simp only [authed] at hx; split at hx <;> (try split at hx) <;> simp_all
  | join c =>
    simp only [authed] at hx; split at hx <;> (try split at hx) <;> simp_all
  | sightings vs =>
    simp only [authed] at hx; split at hx
    · exact absurd hx hnot
    · simp only [List.mem_append, List.mem_filter, List.mem_map] at hx
      rcases hx with ⟨h1, _⟩ | ⟨v, _, rfl⟩
      · exact absurd h1 hnot
      · rfl
  | recommend v n g =>
    simp only [authed] at hx; split at hx <;> (try split at hx) <;> simp_all
  | forget => simp_all [authed, dropEmpty, removeUser]
  | _ => simp_all [authed, dropEmpty]

/-- Other users' sightings are never removed or changed. -/
theorem authed_keeps_others_sightings (r : Req) :
    ∀ x ∈ s.sightings, x.user ≠ u.id → x ∈ (authed s u now r).1.sightings := by
  intro x hx hne
  cases r with
  | createGroup n c => simp only [authed]; split <;> (try split) <;> simp_all
  | join c => simp only [authed]; split <;> (try split) <;> simp_all
  | sightings vs =>
    simp only [authed]; split
    · exact hx
    · simp only [List.mem_append, List.mem_filter]
      exact .inl ⟨hx, by simp [hne]⟩
  | recommend v n g => simp only [authed]; split <;> (try split) <;> simp_all
  | forget => simp_all [authed, dropEmpty, removeUser]
  | _ => simp_all [authed, dropEmpty]

/-- New recs belong to the requesting user and go only to groups they are a member of. -/
theorem authed_new_recs_own (r : Req) (h : (authed s u now r).1 = s') :
    ∀ x ∈ s'.recs, x ∉ s.recs → x.user = u.id ∧ (x.group, u.id) ∈ s.members := by
  subst h
  intro x hx hnot
  cases r with
  | createGroup n c => simp only [authed] at hx; split at hx <;> (try split at hx) <;> simp_all
  | join c => simp only [authed] at hx; split at hx <;> (try split at hx) <;> simp_all
  | leave g => simp_all [authed, dropEmpty]
  | sightings vs => simp only [authed] at hx; split at hx <;> simp_all
  | recommend v n g =>
    simp only [authed] at hx
    split at hx
    · exact absurd hx hnot
    · split at hx
      · exact absurd hx hnot
      · simp only [List.mem_append, List.mem_map, List.mem_filter, myGroupIds, List.mem_map,
          List.mem_filter] at hx
        rcases hx with h1 | ⟨gid, ⟨⟨p, ⟨hp, hpu⟩, rfl⟩, _⟩, rfl⟩
        · exact absurd h1 hnot
        · simp only [beq_iff_eq] at hpu
          exact ⟨rfl, by rw [← hpu]; exact hp⟩
  | forget => simp_all [authed, dropEmpty, removeUser]
  | _ => simp_all [authed]

/-- New memberships are always the requesting user's, and come only from creating a group
(as its first member) or from joining with that group's exact invite code. -/
theorem authed_new_members (r : Req) (h : (authed s u now r).1 = s') :
    ∀ p ∈ s'.members, p ∉ s.members →
      p.2 = u.id ∧
      ((∃ code, r = .join code ∧ ∃ g ∈ s.groups, g.id = p.1 ∧ g.code = normCode code) ∨
       (∃ n c, r = .createGroup n c ∧ p.1 = s.nextId)) := by
  subst h
  intro p hp hnot
  cases r with
  | createGroup n c =>
    simp only [authed] at hp
    split at hp
    · exact absurd hp hnot
    · split at hp
      · exact absurd hp hnot
      · simp only [List.mem_append, List.mem_singleton] at hp
        rcases hp with h1 | rfl
        · exact absurd h1 hnot
        · exact ⟨rfl, .inr ⟨n, c, rfl, rfl⟩⟩
  | join c =>
    simp only [authed] at hp
    split at hp
    · exact absurd hp hnot
    · rename_i g hg
      split at hp
      · exact absurd hp hnot
      · simp only [List.mem_append, List.mem_singleton] at hp
        rcases hp with h1 | rfl
        · exact absurd h1 hnot
        · refine ⟨rfl, .inl ⟨c, rfl, g, List.mem_of_find?_eq_some hg, rfl, ?_⟩⟩
          simpa using List.find?_some hg
  | leave g =>
    simp only [authed, mem_dropEmpty_members, List.mem_filter] at hp
    exact absurd hp.1 hnot
  | sightings vs => simp only [authed] at hp; split at hp <;> simp_all
  | recommend v n g => simp only [authed] at hp; split at hp <;> (try split at hp) <;> simp_all
  | forget =>
    simp only [authed, mem_dropEmpty_members, removeUser, List.mem_filter] at hp
    exact absurd hp.1 hnot
  | _ => simp_all [authed]

/-- Other users' memberships are never removed. -/
theorem authed_keeps_others_members (r : Req) :
    ∀ p ∈ s.members, p.2 ≠ u.id → p ∈ (authed s u now r).1.members := by
  intro p hp hne
  cases r with
  | createGroup n c => simp only [authed]; split <;> (try split) <;> simp_all
  | join c => simp only [authed]; split <;> (try split) <;> simp_all
  | leave g => simp_all [authed, dropEmpty]
  | sightings vs => simp only [authed]; split <;> simp_all
  | recommend v n g => simp only [authed]; split <;> (try split) <;> simp_all
  | forget => simp_all [authed, dropEmpty, removeUser]
  | _ => simp_all [authed]

/-- No authenticated request creates accounts, and only `forget` removes one: the requester's own. -/
theorem authed_users (r : Req) :
    (∀ x ∈ (authed s u now r).1.users, x ∈ s.users) ∧
    (∀ x ∈ s.users, x.id ≠ u.id → x ∈ (authed s u now r).1.users) := by
  constructor
  · intro x hx
    cases r with
    | createGroup n c => simp only [authed] at hx; split at hx <;> (try split at hx) <;> simp_all
    | join c => simp only [authed] at hx; split at hx <;> (try split at hx) <;> simp_all
    | sightings vs => simp only [authed] at hx; split at hx <;> simp_all
    | recommend v n g => simp only [authed] at hx; split at hx <;> (try split at hx) <;> simp_all
    | forget => simp_all [authed, dropEmpty, removeUser]
    | _ => simp_all [authed, dropEmpty]
  · intro x hx hne
    cases r with
    | createGroup n c => simp only [authed]; split <;> (try split) <;> simp_all
    | join c => simp only [authed]; split <;> (try split) <;> simp_all
    | sightings vs => simp only [authed]; split <;> simp_all
    | recommend v n g => simp only [authed]; split <;> (try split) <;> simp_all
    | forget => simp_all [authed, dropEmpty, removeUser]
    | _ => simp_all [authed, dropEmpty]

/-! ## Reads: a user only sees what their groups share -/

theorem shares_sound {s : State} {a b : Uid} (h : shares s a b = true) :
    ∃ g, (g, a) ∈ s.members ∧ (g, b) ∈ s.members := by
  simp only [shares, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, isMember, decide_eq_true_eq] at h
  obtain ⟨⟨g, a'⟩, hm, rfl, hb⟩ := h
  exact ⟨g, hm, hb⟩

/-- **Feeds only include members' items.** Every feed item is a stored sighting from someone else
who shares a group with the reader, and every rec is someone else's, sent to one of the reader's groups.
Reading the feed changes nothing. -/
theorem authed_feed (since : Nat) {rs : List Rec} {xs : List Sighting}
    (h : authed s u now (.feed since) = (s', .feed rs xs)) :
    s' = s ∧
    (∀ x ∈ xs, x ∈ s.sightings ∧ x.user ≠ u.id ∧ ∃ g, (g, u.id) ∈ s.members ∧ (g, x.user) ∈ s.members) ∧
    (∀ r ∈ rs, r ∈ s.recs ∧ r.user ≠ u.id ∧ (r.group, u.id) ∈ s.members) := by
  simp only [authed, Prod.mk.injEq, Resp.feed.injEq] at h
  obtain ⟨rfl, rfl, rfl⟩ := h
  refine ⟨rfl, ?_, ?_⟩
  · intro x hx
    simp only [List.mem_filter, Bool.and_eq_true, bne_iff_ne, ne_eq] at hx
    exact ⟨hx.1, hx.2.1.1.1, shares_sound hx.2.1.1.2⟩
  · intro r hr
    simp only [List.mem_filter, Bool.and_eq_true, bne_iff_ne, ne_eq, List.contains_iff_mem, myGroupIds,
      List.mem_map, List.mem_filter, beq_iff_eq] at hr
    obtain ⟨hr1, hne, ⟨p, ⟨hp, hpu⟩, hpg⟩⟩ := hr
    refine ⟨hr1, hne, ?_⟩
    rw [← hpg, ← hpu]; exact hp

/-- Group listings only ever show groups the requester is (now) a member of. -/
theorem authed_groups_visible (r : Req) {gs : List GroupView} (h : authed s u now r = (s', .groups gs)) :
    ∀ v ∈ gs, (v.group.id, u.id) ∈ s'.members := by
  have key : ∀ t : State, ∀ v ∈ myGroups t u.id, (v.group.id, u.id) ∈ t.members := by
    intro t v hv
    simp only [myGroups, List.mem_map, List.mem_filter, isMember, decide_eq_true_eq] at hv
    obtain ⟨g, ⟨_, hg⟩, rfl⟩ := hv
    exact hg
  cases r with
  | me => simp only [authed, Prod.mk.injEq, Resp.groups.injEq] at h; obtain ⟨rfl, rfl⟩ := h; exact key _
  | createGroup n c =>
    simp only [authed] at h; split at h
    · simp at h
    · split at h
      · simp at h
      · simp only [Prod.mk.injEq, Resp.groups.injEq] at h; obtain ⟨rfl, rfl⟩ := h; exact key _
  | join c =>
    simp only [authed] at h; split at h
    · simp at h
    · simp only [Prod.mk.injEq, Resp.groups.injEq] at h; obtain ⟨rfl, rfl⟩ := h; exact key _
  | leave g => simp only [authed, Prod.mk.injEq, Resp.groups.injEq] at h; obtain ⟨rfl, rfl⟩ := h; exact key _
  | sightings vs => simp only [authed] at h; split at h <;> simp at h
  | recommend v n g => simp only [authed] at h; split at h <;> (try split at h) <;> simp at h
  | signup n f => simp [authed] at h
  | feed since => simp [authed] at h
  | forget => simp [authed] at h

/-- Signup is the only route that issues a token; authenticated routes never return one. -/
theorem authed_never_issues_tokens (r : Req) (t : Str) (i : Uid) : authed s u now r ≠ (s', .signedUp t i) := by
  intro h
  cases r with
  | createGroup n c => simp only [authed] at h; split at h <;> (try split at h) <;> simp at h
  | join c => simp only [authed] at h; split at h <;> simp at h
  | sightings vs => simp only [authed] at h; split at h <;> simp at h
  | recommend v n g => simp only [authed] at h; split at h <;> (try split at h) <;> simp at h
  | _ => simp [authed] at h

end FriendoTube
