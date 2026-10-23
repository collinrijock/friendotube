import FriendoTube.Limits
/-!
# Model of the FriendoTube API (`server/server.mjs`)

Each definition here is mirrored 1:1 in `server/server.mjs`; the JS cites the
definition and the theorems that depend on it (`-- Lean: ...` comments).

Strings are `List Char`, so lengths are counted in code points. The JS counts
UTF-16 units, which is never fewer, so every bound proven here also holds there.
-/
namespace FriendoTube

abbrev Str := List Char
abbrev Uid := Nat
abbrev Gid := Nat

def isWs (c : Char) : Bool := c.isWhitespace
def trim (s : Str) : Str := ((s.dropWhile isWs).reverse.dropWhile isWs).reverse
/-- JS `text(v, max)`: trim, then cut to `n`. -/
def text (n : Nat) (s : Str) : Str := (trim s).take n

/-- JS `VIDEO_ID` regex (generated from `idAlphabet`). -/
def validIdChar (c : Char) : Bool := idAlphabet.contains c
def validId (id : Str) : Bool := id.length == videoIdLength && id.all validIdChar

/-- JS invite-code normalisation: cut to `maxCode`, ASCII upper-case only. -/
def normCode (s : Str) : Str := (text maxCode s).map Char.toUpper

structure Video where
  id : Str
  title : Str
  channel : Str

/-- JS `cleanVideo`. -/
def cleanVideo (v : Video) : Option Video :=
  if validId v.id then
    let t := text maxTitle v.title
    some { id := v.id, title := if t.isEmpty then untitled else t, channel := text maxChannel v.channel }
  else none

structure User where
  id : Uid
  name : Str
  /-- Only the SHA-256 of the access key is stored. -/
  tokenHash : Str

structure Group where
  id : Gid
  name : Str
  code : Str

structure Sighting where
  user : Uid
  video : Video
  seenAt : Nat

structure Rec where
  user : Uid
  group : Gid
  video : Video
  note : Str
  createdAt : Nat

/-- The database: one list per table. -/
structure State where
  users : List User
  groups : List Group
  members : List (Gid × Uid)
  sightings : List Sighting
  recs : List Rec
  nextId : Nat

/-- One constructor per route. Randomness (fresh tokens and codes) arrives as an argument. -/
inductive Req
  | signup (name : Str) (freshToken : Str)
  | me
  | createGroup (name : Str) (freshCode : Str)
  | join (code : Str)
  | leave (g : Gid)
  | sightings (videos : List Video)
  | recommend (v : Video) (note : Str) (group : Option Gid)
  | feed (since : Nat)
  | forget

structure GroupView where
  group : Group
  members : List Uid

inductive Resp
  | err (status : Nat)
  | signedUp (token : Str) (user : Uid)
  | groups (gs : List GroupView)
  | feed (recs : List Rec) (items : List Sighting)
  | ok

section
variable (hash : Str → Str)

/-- JS: `SELECT … FROM users WHERE token = ?` with `hashToken(bearer)`. -/
def auth (s : State) : Option Str → Option User
  | none => none
  | some t => s.users.find? (fun u => u.tokenHash == hash t)
end

def isMember (s : State) (g : Gid) (u : Uid) : Bool := decide ((g, u) ∈ s.members)

/-- JS `myGroups` (ids). -/
def myGroupIds (s : State) (u : Uid) : List Gid := (s.members.filter (fun p => p.2 == u)).map (·.1)

/-- JS `myGroups`. -/
def myGroups (s : State) (u : Uid) : List GroupView :=
  (s.groups.filter (fun g => isMember s g.id u)).map
    (fun g => ⟨g, (s.members.filter (fun p => p.1 == g.id)).map (·.2)⟩)

/-- JS `FRIENDS` subquery: `w` shares at least one group with `u`. -/
def shares (s : State) (u w : Uid) : Bool := s.members.any (fun p => p.2 == u && isMember s p.1 w)

/-- JS `dropEmptyGroups` (plus the `ON DELETE CASCADE` of the group's recs). -/
def dropEmpty (s : State) : State :=
  let live := fun g : Gid => s.members.any (fun p => p.1 == g)
  { s with groups := s.groups.filter (fun g => live g.id), recs := s.recs.filter (fun r => live r.group) }

/-- JS `DELETE FROM users WHERE id = ?` with its cascades. -/
def removeUser (s : State) (u : Uid) : State :=
  { s with users := s.users.filter (fun x => x.id != u), members := s.members.filter (fun p => p.2 != u),
           sightings := s.sightings.filter (fun x => x.user != u), recs := s.recs.filter (fun r => r.user != u) }

/-- Every route except signup, run as the authenticated user `u`. -/
def authed (s : State) (u : User) (now : Nat) : Req → State × Resp
  | .signup .. => (s, .err 400)
  | .me => (s, .groups (myGroups s u.id))
  | .createGroup name code =>
      let n := text maxGroupName name
      if n.isEmpty then (s, .err 400)
      else if s.groups.any (fun g => g.code == code) then (s, .err 500)
      else
        let s' := { s with groups := s.groups ++ [⟨s.nextId, n, code⟩],
                           members := s.members ++ [(s.nextId, u.id)], nextId := s.nextId + 1 }
        (s', .groups (myGroups s' u.id))
  | .join code =>
      match s.groups.find? (fun g => g.code == normCode code) with
      | none => (s, .err 404)
      | some g =>
          let s' := if isMember s g.id u.id then s else { s with members := s.members ++ [(g.id, u.id)] }
          (s', .groups (myGroups s' u.id))
  | .leave g =>
      let s' := dropEmpty { s with members := s.members.filter (fun p => !(p.1 == g && p.2 == u.id)) }
      (s', .groups (myGroups s' u.id))
  | .sightings vs =>
      if vs.length > maxVideos then (s, .err 400)
      else
        let clean := vs.filterMap cleanVideo
        let kept := s.sightings.filter (fun x => !(x.user == u.id && clean.any (fun v => v.id == x.video.id)))
        ({ s with sightings := kept ++ clean.map (fun v => ⟨u.id, v, now⟩) }, .ok)
  | .recommend v note g =>
      match cleanVideo v with
      | none => (s, .err 400)
      | some cv =>
          let gs := (myGroupIds s u.id).filter (fun x => g.all (· == x))
          if gs.isEmpty then (s, .err 400)
          else ({ s with recs := s.recs ++ gs.map (fun x => ⟨u.id, x, cv, text maxNote note, now⟩) }, .ok)
  | .feed since =>
      let mine := myGroupIds s u.id
      let recs := s.recs.filter (fun r => r.user != u.id && mine.contains r.group)
      let items := s.sightings.filter (fun x => x.user != u.id && shares s u.id x.user && decide (since < x.seenAt)
          && !(s.sightings.any (fun y => y.user == u.id && y.video.id == x.video.id)))
      (s, .feed recs items)
  | .forget => (dropEmpty (removeUser s u.id), .ok)

/-- The whole API: signup is the only route that runs without a valid token. -/
def handle (hash : Str → Str) (s : State) (tok : Option Str) (now : Nat) (r : Req) : State × Resp :=
  match r with
  | .signup name fresh =>
      let n := text maxName name
      if n.isEmpty then (s, .err 400)
      else ({ s with users := s.users ++ [⟨s.nextId, n, hash fresh⟩], nextId := s.nextId + 1 },
            .signedUp fresh s.nextId)
  | _ => match auth hash s tok with
    | none => (s, .err 401)
    | some u => authed s u now r

end FriendoTube
