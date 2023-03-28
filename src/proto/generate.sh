#!/bin/bash

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)

pushd $ROOT_DIR > /dev/null || exit

install_dependencies () {
    go install github.com/bufbuild/buf/cmd/buf@v1.8.0
}

install_dependencies
buf lint
buf generate

popd > /dev/null || exit
