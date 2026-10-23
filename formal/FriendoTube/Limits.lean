/-!
# Limits

The single source of truth for every input bound and the video-id alphabet.
`lake exe gen` writes these into `server/limits.gen.mjs` and `extension/limits.gen.js`;
CI fails if the generated files drift from this file.
-/
namespace FriendoTube

def maxName : Nat := 40
def maxGroupName : Nat := 60
def maxTitle : Nat := 200
def maxChannel : Nat := 100
def maxNote : Nat := 280
def maxCode : Nat := 20
def maxVideos : Nat := 200
def maxShelf : Nat := 30
def videoIdLength : Nat := 11

/-- The only characters a video id may contain (YouTube's base64url alphabet). -/
def idAlphabet : List Char :=
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toList

/-- Shown when a video arrives with an empty title. -/
def untitled : List Char := "(untitled)".toList

end FriendoTube
