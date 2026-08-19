FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
EXPOSE 4310
CMD ["npm","run","start"]
