#!/bin/sh
set -eu

cmake_bin=${CMAKE_BIN:?Set CMAKE_BIN to the task-local verified CMake binary}
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=${IFCPP_BUILD_DIR:-"$root/build"}
source_dir="$build_dir/vendor/ifcplusplus"
commit=7b80900197b1f17cdafe47e0548e8eec056a3c9c

mkdir -p "$build_dir/vendor"
if [ ! -d "$source_dir/.git" ]; then
  git init -q "$source_dir"
  git -C "$source_dir" remote add origin https://github.com/ifcquery/ifcplusplus.git
  git -C "$source_dir" fetch -q --depth 1 origin "$commit"
  git -C "$source_dir" checkout -q --detach FETCH_HEAD
fi

test "$(git -C "$source_dir" rev-parse HEAD)" = "$commit"
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
test "$(git -C "$source_dir" status --short | wc -l | tr -d ' ')" = 2
if grep -qE 'external/(zippy|nowide|zip-master)' "$source_dir/IfcPlusPlus/CMakeLists.txt" "$source_dir/IfcPlusPlus/src/ifcpp/reader/ReaderSTEP.cpp"; then
  echo "forbidden ZIP dependency remains in the compiled source closure" >&2
  exit 1
fi

"$cmake_bin" -S "$root" -B "$build_dir/native" -DCMAKE_BUILD_TYPE=Release -DIFCPP_SOURCE_DIR="$source_dir" -DCMAKE_OSX_ARCHITECTURES=arm64
"$cmake_bin" --build "$build_dir/native" --target ifcplusplus-derivative -j 4
echo "$build_dir/native/ifcplusplus-derivative"
