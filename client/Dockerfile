FROM node:20-alpine as builder

WORKDIR /client

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

FROM node:20-alpine

WORKDIR /client

RUN npm install -g http-server

COPY --from=builder /client/dist ./dist

EXPOSE 5173

CMD ["http-server", "dist", "-p", "5173", "-c-1"]
