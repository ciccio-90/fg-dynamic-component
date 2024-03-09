#!/bin/bash

cd "$(dirname "$0")"
rimraf .angular
rimraf node_modules
rimraf package-lock.json
ncu -u
npm install