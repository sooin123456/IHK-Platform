#!/bin/sh
set -eu

cmake_bin=${CMAKE_BIN:?Set CMAKE_BIN to the task-local verified CMake binary}
cmake_archive=${CMAKE_ARCHIVE:?Set CMAKE_ARCHIVE to the task-local official CMake archive}
cmake_sha_file=${CMAKE_SHA256_FILE:?Set CMAKE_SHA256_FILE to the task-local official SHA-256 file}
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=${IFCPP_BUILD_DIR:-"$root/build"}
source_dir="$build_dir/vendor/ifcplusplus"
commit=7b80900197b1f17cdafe47e0548e8eec056a3c9c
cmake_sha=0c5d65251c14cc884bfa16bdbed3c263ce5bffe2e21c0d0d00962cb0610464fa
patch_sha=243830d32924d02d02ad7202d0148982d535f282b4da291ab6dc01701db0365e
cmake_file_sha=dbc24e9d6c8c6de48ac7f6a0ac8fb9621267504a4ef198e288efe0787a7b6aaa
reader_file_sha=9ef6f1c19ff1c7d76fff50eb32fccec606c0532bc6b366ecabcb3ce916728a14

require_equal() {
  actual=$1
  expected=$2
  label=$3
  if [ "$actual" != "$expected" ]; then
    echo "$label verification failed" >&2
    exit 1
  fi
}

case "$(realpath "$cmake_bin"):$([ -f "$cmake_archive" ] && realpath "$cmake_archive"):$([ -f "$cmake_sha_file" ] && realpath "$cmake_sha_file")" in
  /private/tmp/*:/private/tmp/*:/private/tmp/*) ;;
  *) echo "CMake binary, archive, and SHA file must stay under /private/tmp" >&2; exit 1 ;;
esac
require_equal "$(shasum -a 256 "$cmake_archive" | awk '{print $1}')" "$cmake_sha" "CMake archive SHA-256"
grep -F "$cmake_sha  cmake-4.4.3-macos-universal.tar.gz" "$cmake_sha_file" >/dev/null
"$cmake_bin" --version | grep -F "cmake version 4.4.3" >/dev/null

mkdir -p "$build_dir/vendor"
if [ ! -d "$source_dir/.git" ]; then
  git init -q "$source_dir"
  git -C "$source_dir" remote add origin https://github.com/ifcquery/ifcplusplus.git
  git -C "$source_dir" fetch -q --depth 1 origin "$commit"
  git -C "$source_dir" checkout -q --detach FETCH_HEAD
fi

require_equal "$(git -C "$source_dir" rev-parse HEAD)" "$commit" "IfcPlusPlus commit"
if git -C "$source_dir" apply --check --unidiff-zero --ignore-space-change --ignore-whitespace "$root/patches/no-zip.patch" 2>/dev/null; then
  git -C "$source_dir" apply --unidiff-zero --ignore-space-change --ignore-whitespace "$root/patches/no-zip.patch"
elif ! git -C "$source_dir" apply --reverse --check --unidiff-zero --ignore-space-change --ignore-whitespace "$root/patches/no-zip.patch" 2>/dev/null; then
  echo "pinned dependency does not match the reviewed no-zip patch" >&2
  exit 1
fi
if git -C "$source_dir" status --short | grep -Ev '^( M IfcPlusPlus/CMakeLists.txt| M IfcPlusPlus/src/ifcpp/reader/ReaderSTEP.cpp)$' | grep -q .; then
  echo "unexpected changes in pinned dependency" >&2
  exit 1
fi
require_equal "$(git -C "$source_dir" status --short | wc -l | tr -d ' ')" 2 "patched file count"
require_equal "$(git -C "$source_dir" diff --binary | shasum -a 256 | awk '{print $1}')" "$patch_sha" "complete post-patch diff"
require_equal "$(shasum -a 256 "$source_dir/IfcPlusPlus/CMakeLists.txt" | awk '{print $1}')" "$cmake_file_sha" "patched CMakeLists.txt"
require_equal "$(shasum -a 256 "$source_dir/IfcPlusPlus/src/ifcpp/reader/ReaderSTEP.cpp" | awk '{print $1}')" "$reader_file_sha" "patched ReaderSTEP.cpp"
if grep -qE 'external/(zippy|nowide|zip-master)' "$source_dir/IfcPlusPlus/CMakeLists.txt" "$source_dir/IfcPlusPlus/src/ifcpp/reader/ReaderSTEP.cpp"; then
  echo "forbidden ZIP dependency remains in the compiled source closure" >&2
  exit 1
fi

"$cmake_bin" -S "$root" -B "$build_dir/native" -DCMAKE_BUILD_TYPE=Release -DIFCPP_SOURCE_DIR="$source_dir" -DCMAKE_OSX_ARCHITECTURES=arm64
"$cmake_bin" --build "$build_dir/native" --target ifcplusplus-derivative -j 4
echo "$build_dir/native/ifcplusplus-derivative"
