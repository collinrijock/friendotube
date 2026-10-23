import FriendoTube.Model
/-!
# Input bounds

* `text_le` — every stored string is cut to its cap.
* `cleanVideo_ok` — a video that passes validation has a well-formed id and capped title/channel.
* `validId_alphabet` — a valid id only contains characters from `idAlphabet`.
* `sightings_cap` — a batch over `maxVideos` is rejected without touching the state.
* `handle_bounded` — every route preserves `Bounded`: nothing in the database exceeds a cap.
-/
namespace FriendoTube

def VideoOk (v : Video) : Prop :=
  validId v.id = true ∧ v.title.length ≤ maxTitle ∧ v.channel.length ≤ maxChannel

/-- Every stored string is within its cap and every stored video id is valid. -/
def Bounded (s : State) : Prop :=
  (∀ x ∈ s.users, x.name.length ≤ maxName) ∧
  (∀ g ∈ s.groups, g.name.length ≤ maxGroupName) ∧
  (∀ x ∈ s.sightings, VideoOk x.video) ∧
  (∀ r ∈ s.recs, VideoOk r.video ∧ r.note.length ≤ maxNote)

theorem text_le (n : Nat) (str : Str) : (text n str).length ≤ n := by
  simp only [text, List.length_take]; exact Nat.min_le_left _ _

theorem normCode_le (str : Str) : (normCode str).length ≤ maxCode := by
  simpa [normCode] using text_le maxCode str

theorem validId_alphabet {id : Str} (h : validId id = true) : ∀ c ∈ id, c ∈ idAlphabet := by
  simp only [validId, Bool.and_eq_true, List.all_eq_true, validIdChar, List.contains_iff_mem] at h
  exact h.2

theorem validId_length {id : Str} (h : validId id = true) : id.length = videoIdLength := by
  simp only [validId, Bool.and_eq_true, beq_iff_eq] at h
  exact h.1

theorem cleanVideo_ok {v w : Video} (h : cleanVideo v = some w) : VideoOk w := by
  unfold cleanVideo at h
  split at h
  · rename_i hv
    simp only [Option.some.injEq] at h
    subst h
    refine ⟨hv, ?_, text_le _ _⟩
    split
    · simp [untitled, maxTitle]
    · exact text_le _ _
  · simp at h

variable {hash : Str → Str} {s : State} {tok : Option Str} {now : Nat} {u : User}

theorem sightings_cap (vs : List Video) (h : vs.length > maxVideos) :
    authed s u now (.sightings vs) = (s, .err 400) := by
  simp [authed, h]

theorem bounded_dropEmpty {s : State} (h : Bounded s) : Bounded (dropEmpty s) := by
  obtain ⟨h1, h2, h3, h4⟩ := h
  refine ⟨h1, ?_, h3, ?_⟩
  · intro g hg; simp only [dropEmpty, List.mem_filter] at hg; exact h2 g hg.1
  · intro r hr; simp only [dropEmpty, List.mem_filter] at hr; exact h4 r hr.1

theorem authed_bounded (r : Req) (h : Bounded s) : Bounded (authed s u now r).1 := by
  obtain ⟨h1, h2, h3, h4⟩ := h
  cases r with
  | createGroup n c =>
    simp only [authed]; split
    · exact ⟨h1, h2, h3, h4⟩
    · split
      · exact ⟨h1, h2, h3, h4⟩
      · refine ⟨h1, ?_, h3, h4⟩
        intro g hg
        simp only [List.mem_append, List.mem_singleton] at hg
        rcases hg with hg | rfl
        · exact h2 g hg
        · exact text_le _ _
  | join c =>
    simp only [authed]; split
    · exact ⟨h1, h2, h3, h4⟩
    · split
      · exact ⟨h1, h2, h3, h4⟩
      · exact ⟨h1, h2, h3, h4⟩
  | leave g =>
    simp only [authed]
    exact bounded_dropEmpty ⟨h1, h2, h3, h4⟩
  | sightings vs =>
    simp only [authed]; split
    · exact ⟨h1, h2, h3, h4⟩
    · refine ⟨h1, h2, ?_, h4⟩
      intro x hx
      simp only [List.mem_append, List.mem_filter, List.mem_map, List.mem_filterMap] at hx
      rcases hx with ⟨hx, _⟩ | ⟨v, ⟨w, _, hw⟩, rfl⟩
      · exact h3 x hx
      · exact cleanVideo_ok hw
  | recommend v n g =>
    simp only [authed]; split
    · exact ⟨h1, h2, h3, h4⟩
    · rename_i cv hcv
      split
      · exact ⟨h1, h2, h3, h4⟩
      · refine ⟨h1, h2, h3, ?_⟩
        intro x hx
        simp only [List.mem_append, List.mem_map] at hx
        rcases hx with hx | ⟨_, _, rfl⟩
        · exact h4 x hx
        · exact ⟨cleanVideo_ok hcv, text_le _ _⟩
  | forget =>
    simp only [authed]
    apply bounded_dropEmpty
    refine ⟨?_, h2, ?_, ?_⟩
    · intro x hx; simp only [removeUser, List.mem_filter] at hx; exact h1 x hx.1
    · intro x hx; simp only [removeUser, List.mem_filter] at hx; exact h3 x hx.1
    · intro x hx; simp only [removeUser, List.mem_filter] at hx; exact h4 x hx.1
  | _ => simpa [authed] using ⟨h1, h2, h3, h4⟩

/-- **Nothing over a cap is ever stored.** Every route preserves `Bounded`. -/
theorem handle_bounded (r : Req) (h : Bounded s) : Bounded (handle hash s tok now r).1 := by
  cases r with
  | signup n f =>
    obtain ⟨h1, h2, h3, h4⟩ := h
    simp only [handle]; split
    · exact ⟨h1, h2, h3, h4⟩
    · refine ⟨?_, h2, h3, h4⟩
      intro x hx
      simp only [List.mem_append, List.mem_singleton] at hx
      rcases hx with hx | rfl
      · exact h1 x hx
      · exact text_le _ _
  | _ =>
    simp only [handle]; split
    · exact h
    · exact authed_bounded _ h

end FriendoTube
