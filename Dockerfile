# use latest node js image
FROM node:latest

# work dir /app
WORKDIR /app

# RUN npm install -g serve 

# copy all files to /app
COPY . .

RUN npm install express@4
RUN npm install path-to-regexp@latest
RUN npm install -g @angular/cli

RUN npm install @rollup/rollup-linux-arm64-gnu

RUN npm install
RUN npm run clean-config
# RUN npm run inject-backend --backend=http://localhost:8000
RUN npm run inject-backend --backend=https://backend-api-cors-test-74803432761.asia-northeast1.run.app

RUN ng build --configuration=production

EXPOSE 4200

CMD ["node", "server.js"]