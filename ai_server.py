import argparse
import asyncio
import base64
import hashlib
import json
import math
import struct


SHAPES = {
    "I": [
        [(0, 1), (1, 1), (2, 1), (3, 1)],
        [(2, 0), (2, 1), (2, 2), (2, 3)],
        [(0, 2), (1, 2), (2, 2), (3, 2)],
        [(1, 0), (1, 1), (1, 2), (1, 3)],
    ],
    "J": [
        [(0, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (2, 0), (1, 1), (1, 2)],
        [(0, 1), (1, 1), (2, 1), (2, 2)],
        [(1, 0), (1, 1), (0, 2), (1, 2)],
    ],
    "L": [
        [(2, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (1, 1), (1, 2), (2, 2)],
        [(0, 1), (1, 1), (2, 1), (0, 2)],
        [(0, 0), (1, 0), (1, 1), (1, 2)],
    ],
    "O": [
        [(1, 0), (2, 0), (1, 1), (2, 1)],
        [(1, 0), (2, 0), (1, 1), (2, 1)],
        [(1, 0), (2, 0), (1, 1), (2, 1)],
        [(1, 0), (2, 0), (1, 1), (2, 1)],
    ],
    "S": [
        [(1, 0), (2, 0), (0, 1), (1, 1)],
        [(1, 0), (1, 1), (2, 1), (2, 2)],
        [(1, 1), (2, 1), (0, 2), (1, 2)],
        [(0, 0), (0, 1), (1, 1), (1, 2)],
    ],
    "T": [
        [(1, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (1, 1), (2, 1), (1, 2)],
        [(0, 1), (1, 1), (2, 1), (1, 2)],
        [(1, 0), (0, 1), (1, 1), (1, 2)],
    ],
    "Z": [
        [(0, 0), (1, 0), (1, 1), (2, 1)],
        [(2, 0), (1, 1), (2, 1), (1, 2)],
        [(0, 1), (1, 1), (1, 2), (2, 2)],
        [(1, 0), (0, 1), (1, 1), (0, 2)],
    ],
}

WEIGHTS = {
    "landingHeight": -2,
    "erodedPieceCells": 8,
    "completeLines": 3,
    "rowTransitions": -1.2,
    "columnTransitions": -2.5,
    "holes": -10,
    "wells": -1,
    "maxHeight": -4,
    "aggregateHeight": -0.2,
    "bumpiness": -0.4,
}

AI_VERSION = "10x10-tuned-v2"


def unique_rotations(piece_type):
    seen = set()
    result = []
    for rotation, cells in enumerate(SHAPES[piece_type]):
        key = tuple(sorted(cells))
        if key not in seen:
            seen.add(key)
            result.append(rotation)
    return result


def collides(board, piece_type, rotation, x, y):
    height = len(board)
    width = len(board[0])
    for dx, dy in SHAPES[piece_type][rotation % 4]:
        px = x + dx
        py = y + dy
        if px < 0 or px >= width or py >= height:
            return True
        if py >= 0 and board[py][px]:
            return True
    return False


def get_drop_y(board, piece_type, rotation, x):
    y = -4
    if collides(board, piece_type, rotation, x, y):
        return None
    while not collides(board, piece_type, rotation, x, y + 1):
        y += 1
    return y


def apply_placement(board, piece_type, rotation, x):
    y = get_drop_y(board, piece_type, rotation, x)
    if y is None:
        return None
    copied = [row[:] for row in board]
    top_out = False
    for dx, dy in SHAPES[piece_type][rotation % 4]:
        px = x + dx
        py = y + dy
        if py < 0:
            top_out = True
            continue
        copied[py][px] = piece_type
    cleared_rows = [index for index, row in enumerate(copied) if all(row)]
    remaining = [row for row in copied if not all(row)]
    cleared = len(copied) - len(remaining)
    width = len(board[0])
    while len(remaining) < len(board):
        remaining.insert(0, [0] * width)
    return {
        "board": remaining,
        "lines": cleared,
        "topOut": top_out,
        "x": x,
        "y": y,
        "rotation": rotation,
        "clearedRows": cleared_rows,
    }


def enumerate_placements(board, piece_type):
    width = len(board[0])
    result = []
    for rotation in unique_rotations(piece_type):
        for x in range(-2, width + 2):
            y = get_drop_y(board, piece_type, rotation, x)
            if y is None:
                continue
            cells = [(x + dx, y + dy) for dx, dy in SHAPES[piece_type][rotation]]
            if all(0 <= cx < width for cx, _ in cells):
                result.append({"type": piece_type, "rotation": rotation, "x": x, "y": y})
    return result


def column_heights(board):
    height = len(board)
    width = len(board[0])
    heights = [0] * width
    for x in range(width):
        for y in range(height):
            if board[y][x]:
                heights[x] = height - y
                break
    return heights


def evaluate_board(board, lines_cleared, placement_info=None):
    height = len(board)
    width = len(board[0])
    heights = column_heights(board)
    holes = 0
    row_transitions = 0
    column_transitions = 0

    for x in range(width):
        block_seen = False
        previous_filled = True
        for y in range(height):
            filled = bool(board[y][x])
            if filled:
                block_seen = True
            elif block_seen:
                holes += 1
            if filled != previous_filled:
                column_transitions += 1
            previous_filled = filled
        if not previous_filled:
            column_transitions += 1

    for y in range(height):
        previous_filled = True
        for x in range(width):
            filled = bool(board[y][x])
            if filled != previous_filled:
                row_transitions += 1
            previous_filled = filled
        if not previous_filled:
            row_transitions += 1

    wells = 0
    for x in range(width):
        left = height if x == 0 else heights[x - 1]
        right = height if x == width - 1 else heights[x + 1]
        depth = max(0, min(left, right) - heights[x])
        wells += depth * (depth + 1) / 2

    bumpiness = sum(abs(heights[x] - heights[x + 1]) for x in range(width - 1))
    placement_info = placement_info or {}
    visible_cells = [(x, y) for x, y in placement_info.get("cells", []) if y >= 0]
    if visible_cells:
        landing_height = height - sum(y for _, y in visible_cells) / len(visible_cells)
    else:
        landing_height = 0
    cleared_rows = set(placement_info.get("clearedRows", []))
    eroded_piece_cells = lines_cleared * sum(1 for _, y in visible_cells if y in cleared_rows)
    return {
        "aggregateHeight": sum(heights),
        "completeLines": lines_cleared,
        "landingHeight": landing_height,
        "erodedPieceCells": eroded_piece_cells,
        "holes": holes,
        "bumpiness": bumpiness,
        "wells": wells,
        "rowTransitions": row_transitions,
        "columnTransitions": column_transitions,
        "maxHeight": max(heights),
    }


def score_features(features):
    return sum(features.get(key, 0) * weight for key, weight in WEIGHTS.items())


def merge_features(left, right):
    result = dict(left)
    for key, value in right.items():
        result[key] = result.get(key, 0) + value
    return result


def search(board, piece_type, next_pieces, depth, discount=0.72):
    best = None
    for placement in enumerate_placements(board, piece_type):
        applied = apply_placement(board, piece_type, placement["rotation"], placement["x"])
        if not applied:
            continue
        cells = [
            (placement["x"] + dx, placement["y"] + dy)
            for dx, dy in SHAPES[piece_type][placement["rotation"]]
        ]
        features = evaluate_board(
            applied["board"],
            applied["lines"],
            {"cells": cells, "clearedRows": applied["clearedRows"]},
        )
        score = score_features(features)
        combined = features
        if depth > 1 and next_pieces:
            child = search(applied["board"], next_pieces[0], next_pieces[1:], depth - 1, discount)
            if child:
                score += child["score"] * discount
                combined = merge_features(features, child["features"])
        if best is None or score > best["score"]:
            best = {"placement": placement, "score": score, "features": combined}
    return best


def build_actions(current, placement):
    actions = []
    current_rotation = int(current.get("rotation", 0))
    for _ in range((placement["rotation"] - current_rotation + 4) % 4):
        actions.append("rotateCW")
    dx = placement["x"] - int(current.get("x", 0))
    actions.extend(["right" if dx > 0 else "left"] * abs(dx))
    actions.append("hardDrop")
    return actions


def choose_move(message):
    current = message.get("current")
    if isinstance(current, str):
        current = {"type": current, "x": 3, "rotation": 0}
    if not current:
        return {"type": "move", "seq": message.get("seq"), "error": "missing current piece"}
    board = message["board"]
    piece_type = current["type"]
    depth = max(1, min(3, int(message.get("depth", 2))))
    best = search(board, piece_type, message.get("next", []), depth)
    if not best:
        return {"type": "move", "seq": message.get("seq"), "error": "no legal move"}
    placement = best["placement"]
    return {
        "type": "move",
        "seq": message.get("seq"),
        "x": placement["x"],
        "y": placement["y"],
        "rotation": placement["rotation"],
        "eval": best["score"],
        "score": best["score"],
        "features": best["features"],
        "actions": build_actions(current, placement),
        "source": f"python-websocket-depth-{depth}",
        "aiVersion": AI_VERSION,
    }


async def read_http_headers(reader):
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = await reader.read(1024)
        if not chunk:
            return None
        data += chunk
        if len(data) > 8192:
            raise ValueError("HTTP header too large")
    return data.decode("utf-8", errors="ignore")


def websocket_accept_key(sec_key):
    magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    digest = hashlib.sha1((sec_key + magic).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


async def send_frame(writer, text):
    payload = text.encode("utf-8")
    header = bytearray([0x81])
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length <= 65535:
        header.append(126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", length))
    writer.write(bytes(header) + payload)
    await writer.drain()


async def read_frame(reader):
    first = await reader.readexactly(2)
    opcode = first[0] & 0x0F
    masked = bool(first[1] & 0x80)
    length = first[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if masked else b""
    payload = await reader.readexactly(length)
    if masked:
        payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
    if opcode == 8:
        return None
    if opcode == 9:
        return ""
    return payload.decode("utf-8")


async def handle_client(reader, writer):
    try:
        headers = await read_http_headers(reader)
        if not headers:
            return
        header_lines = headers.split("\r\n")
        header_map = {}
        for line in header_lines[1:]:
            if ":" in line:
                key, value = line.split(":", 1)
                header_map[key.lower()] = value.strip()
        sec_key = header_map.get("sec-websocket-key")
        if not sec_key:
            return
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {websocket_accept_key(sec_key)}\r\n"
            "\r\n"
        )
        writer.write(response.encode("ascii"))
        await writer.drain()
        while True:
            raw = await read_frame(reader)
            if raw is None:
                break
            if not raw:
                continue
            try:
                message = json.loads(raw)
                reply = choose_move(message)
            except Exception as exc:
                reply = {"type": "move", "error": str(exc)}
            await send_frame(writer, json.dumps(reply, ensure_ascii=False))
    except (asyncio.IncompleteReadError, ConnectionResetError):
        pass
    finally:
        writer.close()
        await writer.wait_closed()


async def main():
    parser = argparse.ArgumentParser(description="Tetris AI WebSocket server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = await asyncio.start_server(handle_client, args.host, args.port)
    addresses = ", ".join(str(sock.getsockname()) for sock in server.sockets)
    print(f"Tetris AI WebSocket server listening on {addresses}")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.")
