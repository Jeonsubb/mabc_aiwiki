NODE_PATH=./dist
PATH=./node_modules/.bin:$PATH

.PHONY: install dev build start

install:
	cd server && npm install
	cd client && npm install

dev:
	cd server && npm run dev
	cd client && npm run dev
