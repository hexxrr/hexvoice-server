const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const MAX_USERS_PER_ROOM = 6;

const rooms = new Map();

const server = new WebSocket.Server({
  port: PORT
});

console.log(`HexVoice server running on port ${PORT}`);

function sendJson(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, excludeWs = null) {
  for (const member of room) {
    if (
      member !== excludeWs &&
      member.readyState === WebSocket.OPEN
    ) {
      sendJson(member, data);
    }
  }
}

function getUserList(room) {
  const users = [];

  for (const member of room) {
    users.push({
      name: member.userName || "Unknown"
    });
  }

  return users;
}

function leaveRoom(ws) {

  const roomId = ws.roomId;

  if (!roomId) {
    return;
  }

  const room = rooms.get(roomId);

  if (!room) {
    ws.roomId = null;
    return;
  }

  const leavingName =
    ws.userName || "Unknown";

  room.delete(ws);

  broadcast(
    room,
    {
      type: "user_left",
      name: leavingName,
      users: getUserList(room)
    }
  );

  if (room.size === 0) {
    rooms.delete(roomId);
  }

  ws.roomId = null;
  ws.userName = null;
}

server.on("connection", (ws) => {

  ws.roomId = null;
  ws.userName = null;

  sendJson(ws, {
    type: "connected",
    message: "HexVoice server connected"
  });

  ws.on("message", (data, isBinary) => {

    if (!isBinary) {

      try {

        const message =
          JSON.parse(data.toString());

        /*
         * USER JOIN
         */

        if (message.type === "join") {

          const roomId =
            String(message.room || "")
              .trim()
              .toUpperCase();

          const userName =
            String(message.name || "")
              .trim()
              .substring(0, 20);

          if (!roomId) {

            sendJson(ws, {
              type: "error",
              message: "Room code missing"
            });

            return;
          }

          if (!userName) {

            sendJson(ws, {
              type: "error",
              message: "Name missing"
            });

            return;
          }

          if (ws.roomId) {
            leaveRoom(ws);
          }

          let room = rooms.get(roomId);

          if (!room) {

            room = new Set();

            rooms.set(
              roomId,
              room
            );
          }

          if (
            room.size >=
            MAX_USERS_PER_ROOM
          ) {

            sendJson(ws, {
              type: "room_full",
              message:
                "Room is full. Maximum 6 users."
            });

            return;
          }

          ws.roomId = roomId;
          ws.userName = userName;

          room.add(ws);

          /*
           * Send complete current user list
           * to the person who just joined.
           */

          sendJson(ws, {
            type: "joined",
            room: roomId,
            users: room.size,
            maxUsers: MAX_USERS_PER_ROOM,
            userList: getUserList(room)
          });

          /*
           * Tell everyone else that
           * this user joined.
           */

          broadcast(
            room,
            {
              type: "user_joined",
              name: userName,
              users: room.size,
              userList: getUserList(room)
            },
            ws
          );

          return;
        }

        /*
         * LEAVE ROOM
         */

        if (message.type === "leave") {

          leaveRoom(ws);

          return;
        }

      } catch (error) {

        sendJson(ws, {
          type: "error",
          message: "Invalid message"
        });

      }

      return;
    }

    /*
     * Binary data = voice audio.
     *
     * Relay audio to every other
     * user in the same room.
     */

    if (!ws.roomId) {
      return;
    }

    const room =
      rooms.get(ws.roomId);

    if (!room) {
      return;
    }

    for (const member of room) {

      if (
        member !== ws &&
        member.readyState ===
        WebSocket.OPEN
      ) {

        member.send(
          data,
          {
            binary: true
          }
        );
      }
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });

  ws.on("error", () => {
    leaveRoom(ws);
  });
});

process.on("SIGTERM", () => {

  for (const room of rooms.values()) {

    for (const ws of room) {

      try {
        ws.close();
      } catch (_) {
      }
    }
  }

  rooms.clear();

  server.close(() => {
    process.exit(0);
  });
});
