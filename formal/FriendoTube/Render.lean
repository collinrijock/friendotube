import FriendoTube.Bounds
/-!
# Rendering (`extension/content.js`, `extension/popup.js`)

Each renderer in the extension is modelled as the list of DOM writes it performs.
A write records its sink, where the value came from, and the value.

* `Origin.friend` — anything that came from the server: friends' names, video titles,
  channels, notes, group names, invite codes, error messages. Untrusted.
* `Origin.videoId` — a video id, only ever used after `validId`.
* `Origin.lit` — a string literal in the extension.

Theorems:
* `shelf_safe`, `toast_safe`, `prompt_safe`, `sendButton_safe`, `popup_safe` —
  no renderer ever writes `innerHTML`, and untrusted data only reaches plain-text sinks
  (`textContent`, dialog text, the clipboard).
* `shelf_urls` — the only URL sinks (`href`, `img.src`) get a fixed prefix plus a *valid* id.
* `idAlphabet_inert` — that id can't contain a quote, `<`, `>`, `:`, `/`, `?`, `#`, `&`, `%`, `\`
  or whitespace, so it can't change the URL's scheme, host, path or query, or break out of it.
-/
namespace FriendoTube

inductive Sink
  | textContent | dialogText | clipboard | className | attr | href | imgSrc | innerHTML
  deriving DecidableEq

/-- Sinks that never interpret their value as markup or a URL. -/
def Sink.plain : Sink → Bool
  | .textContent | .dialogText | .clipboard => true
  | _ => false

inductive Origin | lit | friend | videoId
  deriving DecidableEq

structure Write where
  sink : Sink
  origin : Origin
  value : Str

def lit (k : Sink) (v : String) : Write := ⟨k, .lit, v.toList⟩
def untrusted (k : Sink) (v : Str) : Write := ⟨k, .friend, v⟩

/-- The rendering safety property. -/
def Safe (ws : List Write) : Prop :=
  ∀ w ∈ ws, w.sink ≠ .innerHTML ∧ (w.origin = .friend → w.sink.plain = true) ∧
    (w.origin = .videoId → w.sink = .href ∨ w.sink = .imgSrc)

theorem safe_append {a b : List Write} (ha : Safe a) (hb : Safe b) : Safe (a ++ b) := by
  intro w hw
  rcases List.mem_append.mp hw with h | h
  · exact ha w h
  · exact hb w h

theorem safe_flatMap {α} {xs : List α} {f : α → List Write} (h : ∀ x ∈ xs, Safe (f x)) :
    Safe (xs.flatMap f) := by
  intro w hw
  obtain ⟨x, hx, hw⟩ := List.mem_flatMap.mp hw
  exact h x hx w hw

/-! ## The "From your friends" row (`content.js`) -/

/-- One card's data, as `renderShelf` builds it. -/
structure Card where
  id : Str
  title : Str
  channel : Str
  label : Str
  note : Str
  isRec : Bool

def watchUrl (id : Str) : Str := "/watch?v=".toList ++ id
def thumbUrl (id : Str) : Str := "https://i.ytimg.com/vi/".toList ++ id ++ "/mqdefault.jpg".toList

/-- JS `card(v)`. -/
def card (c : Card) : List Write :=
  [lit .className "ft-card", ⟨.href, .videoId, watchUrl c.id⟩,
   lit .className "ft-thumb", ⟨.imgSrc, .videoId, thumbUrl c.id⟩, lit .attr "",
   lit .className "ft-share", lit .textContent "Recommend", lit .attr "Recommend this to your friend groups",
   lit .className "ft-title", untrusted .textContent c.title,
   lit .className "ft-meta", untrusted .textContent c.channel,
   lit .className (if c.isRec then "ft-label ft-rec" else "ft-label"), untrusted .textContent c.label] ++
  (if c.note.isEmpty then [] else
    [lit .className "ft-note", untrusted .textContent ("“".toList ++ c.note ++ "”".toList)])

/-- JS `renderShelf`: drop invalid ids, cap the row, then render. -/
def shelf (cs : List Card) : List Write :=
  [lit .className "ft-shelf", lit .className "ft-head",
   lit .className "ft-h", lit .textContent "From your friends",
   lit .className "ft-sub", lit .textContent "what YouTube is showing them, and what they sent you",
   lit .className "ft-row"] ++
  ((cs.filter (fun c => validId c.id)).take maxShelf).flatMap card

theorem card_safe (c : Card) : Safe (card c) := by
  unfold card
  apply safe_append
  · intro w hw
    simp only [List.mem_cons, List.not_mem_nil, or_false] at hw
    rcases hw with rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl <;>
      simp [lit, untrusted, Sink.plain]
  · split
    · intro w hw; simp at hw
    · intro w hw
      simp only [List.mem_cons, List.not_mem_nil, or_false] at hw
      rcases hw with rfl | rfl <;> simp [lit, untrusted, Sink.plain]

theorem shelf_safe (cs : List Card) : Safe (shelf cs) := by
  unfold shelf
  apply safe_append
  · intro w hw
    simp only [List.mem_cons, List.not_mem_nil, or_false] at hw
    rcases hw with rfl | rfl | rfl | rfl | rfl | rfl | rfl <;> simp [lit]
  · exact safe_flatMap (fun c _ => card_safe c)

theorem card_urls (c : Card) :
    ∀ w ∈ card c, (w.sink = .href ∨ w.sink = .imgSrc) → w.value = watchUrl c.id ∨ w.value = thumbUrl c.id := by
  intro w hw hs
  unfold card at hw
  simp only [List.mem_append, List.mem_cons, List.not_mem_nil, or_false] at hw
  rcases hw with hw | hw
  · rcases hw with rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl <;>
      simp_all [lit, untrusted]
  · split at hw
    · simp at hw
    · simp only [List.mem_cons, List.not_mem_nil, or_false] at hw
      rcases hw with rfl | rfl <;> simp_all [lit, untrusted]

/-- **URLs only carry validated ids.** Every `href` / `img.src` the row writes is a fixed prefix
plus the id of a card whose id passed `validId`. -/
theorem shelf_urls (cs : List Card) :
    ∀ w ∈ shelf cs, (w.sink = .href ∨ w.sink = .imgSrc) →
      ∃ c ∈ cs, validId c.id = true ∧ (w.value = watchUrl c.id ∨ w.value = thumbUrl c.id) := by
  intro w hw hs
  unfold shelf at hw
  rcases List.mem_append.mp hw with hw | hw
  · simp only [List.mem_cons, List.not_mem_nil, or_false] at hw
    rcases hw with rfl | rfl | rfl | rfl | rfl | rfl | rfl <;> simp_all [lit]
  · obtain ⟨c, hc, hw⟩ := List.mem_flatMap.mp hw
    have hc' := List.mem_filter.mp (List.mem_of_mem_take hc)
    exact ⟨c, hc'.1, hc'.2, card_urls c w hw hs⟩

/-- None of the characters a valid id may contain can end or redirect a URL or an attribute. -/
theorem idAlphabet_inert : ∀ c ∈ idAlphabet, c ∉ "\"'<>:/?#&%\\ \t\n\r`=".toList := by
  decide

/-! ## Recommend prompt, toast, send button (`content.js`) -/

/-- JS `recommend`: `prompt(...)` shows the title as dialog text. -/
def prompt (title : Str) : List Write :=
  [untrusted .dialogText ("Recommend “".toList ++ title ++ "” to your friends.\nAdd a note (optional):".toList)]

/-- JS `toast`: messages include server error text. -/
def toast (msg : Str) : List Write := [lit .className "ft-toast", untrusted .textContent msg]

/-- JS `watchButton`. -/
def sendButton : List Write := [lit .className "ft-send", lit .textContent "Send to friends"]

theorem prompt_safe (t : Str) : Safe (prompt t) := by
  intro w hw; simp only [prompt, List.mem_singleton] at hw; subst hw; simp [untrusted, Sink.plain]

theorem toast_safe (m : Str) : Safe (toast m) := by
  intro w hw; simp only [toast, List.mem_cons, List.not_mem_nil, or_false] at hw
  rcases hw with rfl | rfl <;> simp [lit, untrusted, Sink.plain]

theorem sendButton_safe : Safe sendButton := by
  intro w hw; simp only [sendButton, List.mem_cons, List.not_mem_nil, or_false] at hw
  rcases hw with rfl | rfl <;> simp [lit]

/-! ## Popup (`popup.js`) -/

structure GroupRow where
  name : Str
  code : Str
  members : Str

/-- JS `renderGroups`, one group. -/
def groupRow (g : GroupRow) : List Write :=
  [lit .className "group", untrusted .textContent g.name,
   lit .className "code", untrusted .textContent g.code, lit .attr "Click to copy; send this to friends so they can join",
   untrusted .clipboard g.code, lit .textContent "copied!",
   lit .className "link", lit .textContent "leave", untrusted .dialogText ("Leave ".toList ++ g.name ++ "?".toList),
   lit .className "muted", untrusted .textContent g.members]

/-- JS `refresh` + `renderGroups` + `showError`. -/
def popup (me : Str) (err : Str) (gs : List GroupRow) : List Write :=
  [untrusted .textContent err, untrusted .textContent me] ++
  (if gs.isEmpty then [lit .textContent "No groups yet. Create one or join with a friend's code."]
   else gs.flatMap groupRow)

theorem groupRow_safe (g : GroupRow) : Safe (groupRow g) := by
  intro w hw
  simp only [groupRow, List.mem_cons, List.not_mem_nil, or_false] at hw
  rcases hw with rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl | rfl <;>
    simp [lit, untrusted, Sink.plain]

theorem popup_safe (me err : Str) (gs : List GroupRow) : Safe (popup me err gs) := by
  unfold popup
  apply safe_append
  · intro w hw
    simp only [List.mem_cons, List.not_mem_nil, or_false] at hw
    rcases hw with rfl | rfl <;> simp [untrusted, Sink.plain]
  · split
    · intro w hw; simp only [List.mem_singleton] at hw; subst hw; simp [lit]
    · exact safe_flatMap (fun g _ => groupRow_safe g)

end FriendoTube
