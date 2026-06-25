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
    "landingHeight": -2.18,
    "erodedPieceCells": 2.42,
    "rowTransitions": -2.17,
    "columnTransitions": -3.31,
    "holes": 0.95,
    "boardWells": -2.22,
    "holeDepth": -0.81,
    "rowsWithHoles": -9.65,
    "diversity": 1.27,
}

AI_VERSION = "dt10-2013"


def unique_rotations(piece_type):
    seen = set()
    result = []
    for rotation, cells in enumerate(SHAPES[piece_type]):
        min_x = min(x for x, _ in cells)
        min_y = min(y for _, y in cells)
        key = tuple(sorted((x - min_x, y - min_y) for x, y in cells))
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


def is_filled(board, x, y):
    if x < 0 or x >= len(board[0]):
        return True
    if y >= len(board):
        return True
    if y < 0:
        return False
    return bool(board[y][x])


def evaluate_board(board, lines_cleared, placement_info=None):
    height = len(board)
    width = len(board[0])
    heights = column_heights(board)
    placement_info = placement_info or {}
    piece_type = placement_info.get("type")
    rotation = placement_info.get("rotation", 0)
    placement_y = placement_info.get("y", 0)
    shape = SHAPES[piece_type][rotation % 4] if piece_type else []
    min_dy = min((dy for _, dy in shape), default=0)
    max_dy = max((dy for _, dy in shape), default=0)
    lowest_board_y = placement_y + max_dy
    bottom_height = height - 1 - lowest_board_y
    landing_height = bottom_height + (max_dy - min_dy) / 2

    cleared_rows = set(placement_info.get("clearedRows", []))
    piece_cells = placement_info.get("cells", [])
    eroded_piece_cells = lines_cleared * sum(1 for _, y in piece_cells if y in cleared_rows)

    row_transitions = 0
    for y in range(height):
        previous_filled = True
        for x in range(width):
            filled = bool(board[y][x])
            if filled != previous_filled:
                row_transitions += 1
            previous_filled = filled
        if not previous_filled:
            row_transitions += 1

    column_transitions = 0
    for x in range(width):
        previous_filled = False
        for y in range(height):
            filled = bool(board[y][x])
            if filled != previous_filled:
                column_transitions += 1
            previous_filled = filled
        if not previous_filled:
            column_transitions += 1

    holes = 0
    hole_depth = 0
    rows_with_holes = set()
    for x in range(width):
        filled_above = 0
        for y in range(height):
            if board[y][x]:
                filled_above += 1
            elif filled_above > 0:
                holes += 1
                rows_with_holes.add(y)
                hole_depth += filled_above

    board_wells = 0
    for x in range(width):
        well_depth = 0
        for y in range(height):
            well_cell = (
                not board[y][x]
                and is_filled(board, x - 1, y)
                and is_filled(board, x + 1, y)
            )
            if well_cell:
                well_depth += 1
                board_wells += well_depth
            else:
                well_depth = 0

    diversity_values = set()
    for x in range(width - 1):
        diff = heights[x] - heights[x + 1]
        if -2 <= diff <= 2:
            diversity_values.add(diff)

    return {
        "landingHeight": landing_height,
        "erodedPieceCells": eroded_piece_cells,
        "rowTransitions": row_transitions,
        "columnTransitions": column_transitions,
        "holes": holes,
        "boardWells": board_wells,
        "holeDepth": hole_depth,
        "rowsWithHoles": len(rows_with_holes),
        "diversity": len(diversity_values),
    }


def score_features(features):
    return sum(features.get(key, 0) * weight for key, weight in WEIGHTS.items())


def search(board, piece_type):
    best = None
    for placement in enumerate_placements(board, piece_type):
        applied = apply_placement(board, piece_type, placement["rotation"], placement["x"])
        if not applied or applied["topOut"]:
            continue
        cells = [
            (placement["x"] + dx, placement["y"] + dy)
            for dx, dy in SHAPES[piece_type][placement["rotation"]]
        ]
        features = evaluate_board(
            applied["board"],
            applied["lines"],
            {
                "type": piece_type,
                "rotation": placement["rotation"],
                "x": placement["x"],
                "y": placement["y"],
                "cells": cells,
                "clearedRows": applied["clearedRows"],
            },
        )
        score = score_features(features)
        if (
            best is None
            or score > best["score"]
            or (
                score == best["score"]
                and (
                    placement["rotation"] < best["placement"]["rotation"]
                    or (
                        placement["rotation"] == best["placement"]["rotation"]
                        and placement["x"] < best["placement"]["x"]
                    )
                )
            )
        ):
            best = {"placement": placement, "score": score, "features": features}
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
    best = search(board, piece_type)
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
        "source": AI_VERSION,
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
