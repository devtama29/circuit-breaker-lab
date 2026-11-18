FROM node:24-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY app.js .
EXPOSE 80
CMD ["node", "app.js"]