#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREES_DIR="$ROOT_DIR/.worktrees"

ADJECTIVES=(amber ashen azure bleak bold brave brisk calm clear cold cool coral crisp dark dawn deep dense dire draft dry dull dusk eager even fair fast fell fern fierce fine firm flat fond free fresh frost full gilt glad gold good gray green grim hale hazel hazy held high holy iron ivory jade just keen kind lank last lean light lilac live lone long lost lucid lunar main maple mild mint mossy mute near neat next noble north oaken odd olive open pale past pearl pine plain plum prime proud pure quartz quiet rare raw real red rich ripe rosy rough ruby safe sage salt sharp sheer silver slim slow small smoky soft solid south spare stark steep still stone stout strong subtle sure swift tall tame taut teal thick thin tidy tough true umber vast vivid warm west white whole wide wild wiry wise woven young)
NOUNS=(acre alder apex arc ash atlas axle bark basin bay beam birch blade bloom bluff bolt bone bow brace bridge brook briar cairn cape cedar chill chord cleft cliff cloud coast coral core cove crane crest croft cross crown curve dale dew dock dome dove draft drift drum dune dust echo edge elm ember end fall fault fawn fen fern field flare fleet flint flora ford forge fox frame frost gale gate gem glade glen glow gorge grain grove gust harbor haven hawk haze heath hedge helm hill hold hollow horn hub husk inlet iron isle ivy jar jest keel kelp knoll knot lake larch lark latch lea ledge lilac linen loch lodge loom lore marsh mast maze mead mesa mill mint mist moor moss mount muse nest node notch oak opal orbit ore owl palm pass patch path peak pearl pine pitch plain plume point pond porch post prime prism pulse quay quill raft rail rain range reach reed reef ridge rift rim ring rise road rock root rose roost rune rush sage salt sand seal seed shade shard shaw shell shore shrub silt slate slope smoke snag spar spark spire spoke spring spruce spur staff stage stake star steep stem still stone strand stream stump surge swale swift tarn teal thaw thorn tide timber trail trove trunk vale vault veil vine wade wake wall ward wash wave weld well wharf wheat wick wield wilt wind wing wood wren yard yew)

random_name() {
  local adj="${ADJECTIVES[$((RANDOM % ${#ADJECTIVES[@]}))]}"
  local noun="${NOUNS[$((RANDOM % ${#NOUNS[@]}))]}"
  echo "${adj}-${noun}"
}

NAME="$(random_name)"
WORKTREE_PATH="$WORKTREES_DIR/$NAME"

while [[ -d "$WORKTREE_PATH" ]]; do
  NAME="$(random_name)"
  WORKTREE_PATH="$WORKTREES_DIR/$NAME"
done

mkdir -p "$WORKTREES_DIR"
git -C "$ROOT_DIR" worktree add -b "$NAME" "$WORKTREE_PATH" HEAD

if [[ -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env" "$WORKTREE_PATH/.env"
  echo "Copied .env to worktree"
fi

echo "Worktree ready at $WORKTREE_PATH"
cd "$WORKTREE_PATH"
