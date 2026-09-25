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

function getRoomMembers(room) {

    return Array.from(room).map((member) => ({
        id: member.userId,
        name: member.userName,
        mic: member.micMuted ? false : true
    }));
}

function broadcastRoomMembers(room) {

    const members =
        getRoomMembers(room);

    for (const member of room) {

        sendJson(member, {
            type: "room_members",
            members: members
        });
    }
}

function leaveRoom(ws) {

    const roomId =
        ws.roomId;

    if (!roomId) {
        return;
    }

    const room =
        rooms.get(roomId);

    if (!room) {

        ws.roomId = null;

        return;
    }

    room.delete(ws);

    for (const member of room) {

        sendJson(member, {
            type: "user_left",
            name: ws.userName || "Unknown"
        });
    }

    broadcastRoomMembers(room);

    if (room.size === 0) {
        rooms.delete(roomId);
    }

    ws.roomId = null;
}

server.on("connection", (ws) => {

    ws.roomId = null;
    ws.userId = null;
    ws.userName = null;
    ws.micMuted = false;

    sendJson(ws, {
        type: "connected",
        message: "HexVoice server connected"
    });

    ws.on("message", (data, isBinary) => {

        if (!isBinary) {

            try {

                const message =
                    JSON.parse(
                        data.toString()
                    );

                if (
                    message.type === "join"
                ) {

                    const roomId =
                        String(
                            message.room || ""
                        )
                            .trim()
                            .toUpperCase();

                    const userName =
                        String(
                            message.name || ""
                        )
                            .trim()
                            .substring(
                                0,
                                20
                            );

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

                    let room =
                        rooms.get(roomId);

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

                    ws.roomId =
                        roomId;

                    ws.userId =
                        Math.random()
                            .toString(36)
                            .substring(
                                2,
                                10
                            );

                    ws.userName =
                        userName;

                    ws.micMuted =
                        false;

                    room.add(ws);

                    sendJson(ws, {
                        type: "joined",
                        room: roomId,
                        name: userName,
                        users: room.size,
                        maxUsers:
                            MAX_USERS_PER_ROOM
                    });

                    for (
                        const member of room
                    ) {

                        if (
                            member !== ws
                        ) {

                            sendJson(member, {
                                type: "user_joined",
                                name: userName,
                                users: room.size
                            });
                        }
                    }

                    broadcastRoomMembers(room);

                    return;
                }

                if (
                    message.type === "mic_status"
                ) {

                    if (!ws.roomId) {
                        return;
                    }

                    const room =
                        rooms.get(
                            ws.roomId
                        );

                    if (!room) {
                        return;
                    }

                    ws.micMuted =
                        message.muted === true;

                    broadcastRoomMembers(room);

                    return;
                }

                if (
                    message.type === "leave"
                ) {

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

        if (!ws.roomId) {
            return;
        }

        const room =
            rooms.get(
                ws.roomId
            );

        if (!room) {
            return;
        }

        for (
            const member of room
        ) {

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

    for (
        const room of rooms.values()
    ) {

        for (
            const ws of room
        ) {

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
