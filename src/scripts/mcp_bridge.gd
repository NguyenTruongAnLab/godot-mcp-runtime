extends Node

# KEEP IN SYNC: src/utils/bridge-protocol.ts implements the same framing on the
# Node side. Any change here MUST be mirrored there (and vice versa).
#
# Wire format: 4-byte big-endian length prefix + UTF-8 JSON payload.
# Max frame size 16 MiB; oversize frames close the offending peer.

# Port is baked into this script at inject time by BridgeManager.inject - the
# integer literal below is rewritten in the project copy. The 9900 here is the
# source-of-truth default that ships with the script so it remains runnable
# standalone (e.g. validate, manual debugging).
const PORT := 9900  # MCP_BRIDGE_PORT_BAKED
const MAX_FRAME_BYTES := 16 * 1024 * 1024
const FRAME_HEADER_BYTES := 4

class PeerState:
	extends Reference
	var stream: StreamPeerTCP
	var buffer = PoolByteArray()
	var expected_len = -1   # -1 = waiting on header
	var handling = false   # true while a command is awaiting a response

var tcp_server: TCP_Server
var session_token: String = ""
var _peers: Array = []   # Array of PeerState
var _shutting_down: bool = false  # One-shot: set true in shutdown(); never reset (autoload is recreated on next session)

func _ready() -> void:
	pause_mode = Node.PAUSE_MODE_PROCESS
	session_token = OS.get_environment("MCP_SESSION_TOKEN")
	print("McpBridge: Session token read: '", session_token, "'")
	tcp_server = TCP_Server.new()
	var err = tcp_server.listen(PORT, "127.0.0.1")
	if err != OK:
		push_error("McpBridge: Failed to listen on port %d (error %d)" % [PORT, err])
	else:
		print("McpBridge: Listening on TCP port %d" % PORT)

	if OS.get_environment("MCP_BACKGROUND") == "1":
		OS.window_borderless = true
		OS.window_position = Vector2(-9999, -9999)
		OS.set_window_always_on_top(true)
		# Disable input accumulation so Input.parse_input_event() processes
		# each injected event immediately. Without this, background-mode
		# key/mouse injection via simulate_input may be dropped because the
		# OS does not deliver focus events to offscreen windows.
		Input.set_use_accumulated_input(false)
		print("McpBridge: Background mode active - window hidden off-screen")

func _process(_delta: float) -> void:
	if tcp_server == null or not tcp_server.is_listening():
		return

	while tcp_server.is_connection_available():
		var stream := tcp_server.take_connection()
		if stream == null:
			break
		stream.set_no_delay(true)
		var peer := PeerState.new()
		peer.stream = stream
		_peers.append(peer)

	# Backwards iteration so remove_at() doesn't shift entries we haven't seen
	# yet, and avoids the O(n) cost of Array.erase() per removal.
	var i := _peers.size()
	while i > 0:
		i -= 1
		var peer = _peers[i]
		_poll_peer(peer)
		if peer.stream == null or peer.stream.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			_peers.remove(i)

func _poll_peer(peer: PeerState) -> void:
	var status := peer.stream.get_status()
	if status != StreamPeerTCP.STATUS_CONNECTED:
		return

	var available := peer.stream.get_available_bytes()
	if available > 0:
		var chunk: Array = peer.stream.get_partial_data(available)
		# get_partial_data returns [error, PoolByteArray]
		if chunk[0] == OK:
			print("McpBridge: Read chunk of size %d" % chunk[1].size())
			var buf = peer.buffer
			buf.append_array(chunk[1])
			peer.buffer = buf
			print("McpBridge: Buffer size after append: %d" % peer.buffer.size())
		else:
			print("McpBridge: Error reading chunk: %d" % chunk[0])

	while true:
		if peer.expected_len < 0:
			if peer.buffer.size() < FRAME_HEADER_BYTES:
				return
			# Read u32 BE header.
			var header = peer.buffer.subarray(0, FRAME_HEADER_BYTES - 1)
			var b0 := int(header[0])
			var b1 := int(header[1])
			var b2 := int(header[2])
			var b3 := int(header[3])
			peer.expected_len = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
			print("McpBridge: Read frame header, expected body length: %d" % peer.expected_len)
			if FRAME_HEADER_BYTES >= peer.buffer.size():
				peer.buffer = PoolByteArray()
			else:
				peer.buffer = peer.buffer.subarray(FRAME_HEADER_BYTES, peer.buffer.size() - 1)
			if peer.expected_len > MAX_FRAME_BYTES:
				push_error("McpBridge: Frame header exceeds limit (%d), closing peer" % peer.expected_len)
				peer.stream.disconnect_from_host()
				peer.stream = null
				return

		if peer.handling:
			return
		if peer.buffer.size() < peer.expected_len:
			return

		var frame_bytes = PoolByteArray()
		if peer.expected_len > 0:
			frame_bytes = peer.buffer.subarray(0, peer.expected_len - 1)
		if peer.expected_len >= peer.buffer.size():
			peer.buffer = PoolByteArray()
		else:
			peer.buffer = peer.buffer.subarray(peer.expected_len, peer.buffer.size() - 1)
		peer.expected_len = -1

		var data: String = frame_bytes.get_string_from_utf8().strip_edges()
		peer.handling = true
		_dispatch_command(peer, data)
		# _dispatch_command yields internally on async branches (input, run_script,
		# screenshot, shutdown), so control returns here at the first inner yield.
		# `peer.handling` is the gate that blocks re-entry; it is cleared by
		# `_send_response` once the handler completes.

# INVARIANT: every code path through this function and its handlers must
# eventually reach `_send_response`. `peer.handling` is set to true by the
# caller (`_poll_peer`) before dispatch and cleared inside `_send_response`.
# A handler that exits without calling `_send_response` will deadlock the
# peer - the next frame will never be polled. When adding a new branch,
# ensure the early-exit calls `_send_response` with an error payload.
func _dispatch_command(peer: PeerState, data: String) -> void:
	print("McpBridge: Dispatching command data: ", data)
	if not data.begins_with("{"):
		_send_response(peer, {"error": "Non-JSON frame (expected a JSON command object)"})
		return

	var parsed = JSON.parse(data)
	if parsed.error != OK:
		_send_response(peer, {"error": "Invalid JSON: %s" % parsed.error_string})
		return

	var payload = parsed.result
	if typeof(payload) != TYPE_DICTIONARY:
		_send_response(peer, {"error": "Expected JSON object"})
		return

	var command = payload.get("command", "")
	match command:
		"input":
			var actions = payload.get("actions", [])
			if typeof(actions) != TYPE_ARRAY:
				_send_response(peer, {"error": "actions must be an array"})
				return
			if actions.size() == 0:
				_send_response(peer, {"error": "actions array is empty"})
				return
			var input_state = _handle_input(peer, actions)
			if input_state is GDScriptFunctionState:
				yield(input_state, "completed")
		"get_ui_elements":
			_handle_get_ui_elements(peer, payload)
		"run_script":
			var script_state = _handle_run_script(peer, payload)
			if script_state is GDScriptFunctionState:
				yield(script_state, "completed")
		"screenshot":
			var shot_state = _handle_screenshot(peer, payload)
			if shot_state is GDScriptFunctionState:
				yield(shot_state, "completed")
		"shutdown":
			var shutdown_state = _handle_shutdown(peer)
			if shutdown_state is GDScriptFunctionState:
				yield(shutdown_state, "completed")
		"ping":
			_send_response(peer, {"status": "pong", "session_token": session_token, "project_path": ProjectSettings.globalize_path("res://")})
		"performance_metrics":
			_handle_performance_metrics(peer)
		"query_spatial_collision":
			_handle_query_spatial_collision(peer, payload)
		"get_ground_clamp":
			_handle_get_ground_clamp(peer, payload)
		"record_telemetry_sequence":
			var telem_state = _handle_record_telemetry_sequence(peer, payload)
			if telem_state is GDScriptFunctionState:
				yield(telem_state, "completed")
		"navigate_to":
			var nav_state = _handle_navigate_to(peer, payload)
			if nav_state is GDScriptFunctionState:
				yield(nav_state, "completed")
		_:
			_send_response(peer, {"error": "Unknown command: %s" % command})

# --- Performance Metrics ---

func _handle_performance_metrics(peer: PeerState) -> void:
	# Read all Godot 3.x Performance monitor values
	# See: https://docs.godotengine.org/en/3.6/classes/class_performance.html
	var metrics = {
		"fps": Performance.get_monitor(Performance.TIME_FPS),
		"process_time_ms": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		"physics_process_time_ms": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
		"memory_static_bytes": Performance.get_monitor(Performance.MEMORY_STATIC),
		"memory_dynamic_bytes": Performance.get_monitor(Performance.MEMORY_DYNAMIC),
		"memory_static_max_bytes": Performance.get_monitor(Performance.MEMORY_STATIC_MAX),
		"memory_dynamic_max_bytes": Performance.get_monitor(Performance.MEMORY_DYNAMIC_MAX),
		"memory_message_buffer_max_bytes": Performance.get_monitor(Performance.MEMORY_MESSAGE_BUFFER_MAX),
		"objects_count": Performance.get_monitor(Performance.OBJECT_COUNT),
		"resources_count": Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT),
		"nodes_count": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
		"orphan_nodes_count": Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT),
		"render_objects_in_frame": Performance.get_monitor(Performance.RENDER_OBJECTS_IN_FRAME),
		"render_vertices_in_frame": Performance.get_monitor(Performance.RENDER_VERTICES_IN_FRAME),
		"render_material_changes": Performance.get_monitor(Performance.RENDER_MATERIAL_CHANGES_IN_FRAME),
		"render_shader_changes": Performance.get_monitor(Performance.RENDER_SHADER_CHANGES_IN_FRAME),
		"render_surface_changes": Performance.get_monitor(Performance.RENDER_SURFACE_CHANGES_IN_FRAME),
		"render_draw_calls": Performance.get_monitor(Performance.RENDER_DRAW_CALLS_IN_FRAME),
		"render_video_mem_used_bytes": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),
		"render_texture_mem_used_bytes": Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED),
		"render_vertex_mem_used_bytes": Performance.get_monitor(Performance.RENDER_VERTEX_MEM_USED),
		"render_usage_video_mem_total": Performance.get_monitor(Performance.RENDER_USAGE_VIDEO_MEM_TOTAL),
		"physics_2d_active_objects": Performance.get_monitor(Performance.PHYSICS_2D_ACTIVE_OBJECTS),
		"physics_2d_collision_pairs": Performance.get_monitor(Performance.PHYSICS_2D_COLLISION_PAIRS),
		"physics_2d_island_count": Performance.get_monitor(Performance.PHYSICS_2D_ISLAND_COUNT),
		"physics_3d_active_objects": Performance.get_monitor(Performance.PHYSICS_3D_ACTIVE_OBJECTS),
		"physics_3d_collision_pairs": Performance.get_monitor(Performance.PHYSICS_3D_COLLISION_PAIRS),
		"physics_3d_island_count": Performance.get_monitor(Performance.PHYSICS_3D_ISLAND_COUNT),
	}
	_send_response(peer, metrics)

# --- Screenshot ---

func _handle_screenshot(peer: PeerState, payload: Dictionary = {}) -> void:
	yield(VisualServer, "frame_post_draw")

	var viewport := get_viewport()
	if viewport == null:
		_send_response(peer, {"error": "No viewport available"})
		return

	var image := viewport.get_texture().get_data()
	if image == null:
		_send_response(peer, {"error": "Failed to capture viewport image"})
		return
	image.flip_y()

	var timestamp := str(OS.get_unix_time()).replace(".", "_")
	var screenshot_dir := ProjectSettings.globalize_path("res://.mcp/screenshots")
	var dir = Directory.new()
	var dir_err = dir.make_dir_recursive(screenshot_dir)
	if dir_err != OK:
		_send_response(peer, {"error": "Failed to create screenshot directory (error %d)" % dir_err})
		return
	var file_path := screenshot_dir.plus_file("screenshot_%s.png" % timestamp)

	var save_err := image.save_png(file_path)
	if save_err != OK:
		_send_response(peer, {"error": "Failed to save screenshot (error %d)" % save_err})
		return

	var safe_path := file_path.replace("\\", "/")
	var response: Dictionary = {
		"path": safe_path,
		"width": image.get_width(),
		"height": image.get_height(),
	}

	var preview_max_width = int(payload.get("preview_max_width", 0))
	var preview_max_height = int(payload.get("preview_max_height", 0))
	if preview_max_width > 0 and preview_max_height > 0:
		var scale = min(
			1.0,
			min(
				float(preview_max_width) / float(image.get_width()),
				float(preview_max_height) / float(image.get_height())
			)
		)
		var preview_width = max(1, int(floor(float(image.get_width()) * scale)))
		var preview_height = max(1, int(floor(float(image.get_height()) * scale)))
		# Full image already saved to disk - resize in-place to avoid a redundant copy
		image.resize(preview_width, preview_height, Image.INTERPOLATE_CUBIC)
		var preview_path = screenshot_dir.plus_file("screenshot_%s_preview.png" % timestamp)
		var preview_err = image.save_png(preview_path)
		if preview_err != OK:
			_send_response(peer, {"error": "Failed to save screenshot preview (error %d)" % preview_err})
			return
		response["preview_path"] = preview_path.replace("\\", "/")
		response["preview_width"] = preview_width
		response["preview_height"] = preview_height

	_send_response(peer, response)

# --- Input Simulation ---

func _handle_input(peer: PeerState, actions: Array) -> void:
	var processed := 0
	var error_msg := ""

	for action in actions:
		if typeof(action) != TYPE_DICTIONARY:
			error_msg = "Action at index %d is not an object" % processed
			break

		var type = action.get("type", "")
		match type:
			"key":
				var result = _inject_key(action)
				if result != "":
					error_msg = "Action %d (key): %s" % [processed, result]
					break
			"mouse_button":
				var result = _inject_mouse_button(action)
				if result != "":
					error_msg = "Action %d (mouse_button): %s" % [processed, result]
					break
			"mouse_motion":
				_inject_mouse_motion(action)
			"action":
				var result = _inject_action(action)
				if result != "":
					error_msg = "Action %d (action): %s" % [processed, result]
					break
			"click_element":
				var result = _inject_click_element(action)
				if result != "":
					error_msg = "Action %d (click_element): %s" % [processed, result]
					break
			"wait":
				var ms = action.get("ms", 0)
				if typeof(ms) == TYPE_REAL or typeof(ms) == TYPE_INT:
					if ms > 0:
						yield(get_tree().create_timer(ms / 1000.0), "timeout")
				else:
					error_msg = "Action %d (wait): ms must be a number" % processed
					break
			_:
				error_msg = "Action %d: unknown type '%s'" % [processed, type]
				break

		processed += 1

	# Allow queued input events to dispatch and any signal handlers
	# (and their runtime errors) to fire before we reply, so the
	# Node-side stderr scan in sendCommandWithErrors sees them.
	yield(get_tree(), "idle_frame")
	yield(get_tree(), "idle_frame")

	if error_msg != "":
		_send_response(peer, {"error": error_msg, "actions_processed": processed})
	else:
		_send_response(peer, {"success": true, "actions_processed": processed})

func _trigger_actions_for_scancode(scancode, pressed):
	for action in InputMap.get_actions():
		for event in InputMap.get_action_list(action):
			if event is InputEventKey and event.scancode == scancode:
				if pressed:
					Input.action_press(action)
				else:
					Input.action_release(action)

func _inject_key(action: Dictionary) -> String:
	var key_name = action.get("key", "")
	if key_name == "":
		return "key name is required"

	var scancode = OS.find_scancode_from_string(key_name)
	if scancode == 0:
		return "unrecognized key name: '%s'" % key_name

	var event = InputEventKey.new()
	event.scancode = scancode
	event.physical_scancode = scancode
	event.pressed = action.get("pressed", true)
	event.echo = false
	event.shift = action.get("shift", false)
	event.control = action.get("ctrl", false)
	event.alt = action.get("alt", false)
	# Text-entry Controls (LineEdit, TextEdit) consume `event.unicode`, not just
	# the scancode - without it, typing into a focused LineEdit produces nothing.
	# Auto-derive for ASCII letters and digits; fall back to caller-supplied
	# `unicode` for symbols and non-ASCII.
	if action.has("unicode"):
		event.unicode = int(action.unicode)
	elif scancode >= KEY_A and scancode <= KEY_Z:
		event.unicode = scancode if event.shift else (scancode + 32)
	elif scancode >= KEY_0 and scancode <= KEY_9:
		event.unicode = scancode
	Input.parse_input_event(event)

	if OS.get_environment("MCP_BACKGROUND") == "1":
		_trigger_actions_for_scancode(scancode, event.pressed)

	return ""

func _resolve_button_name(button_name: String) -> Array:
	match button_name:
		"left":
			return [BUTTON_LEFT, ""]
		"right":
			return [BUTTON_RIGHT, ""]
		"middle":
			return [BUTTON_MIDDLE, ""]
		_:
			return [0, "unknown button: '%s' (use 'left', 'right', or 'middle')" % button_name]

func _inject_mouse_button(action: Dictionary) -> String:
	var button_result := _resolve_button_name(action.get("button", "left"))
	if button_result[1] != "":
		return button_result[1]
	var button_index = button_result[0]

	var pos = Vector2(action.get("x", 0), action.get("y", 0))
	var double_click = action.get("double_click", false)

	# If pressed is explicitly set, only do that one event
	if action.has("pressed"):
		var event = InputEventMouseButton.new()
		event.button_index = button_index
		event.pressed = action.get("pressed")
		event.position = pos
		event.global_position = pos
		event.doubleclick = double_click
		Input.parse_input_event(event)
	else:
		# Auto press + release (click)
		var press = InputEventMouseButton.new()
		press.button_index = button_index
		press.pressed = true
		press.position = pos
		press.global_position = pos
		press.doubleclick = double_click
		Input.parse_input_event(press)

		var release = InputEventMouseButton.new()
		release.button_index = button_index
		release.pressed = false
		release.position = pos
		release.global_position = pos
		Input.parse_input_event(release)

	return ""

func _inject_mouse_motion(action: Dictionary) -> void:
	var event = InputEventMouseMotion.new()
	event.position = Vector2(action.get("x", 0), action.get("y", 0))
	event.global_position = event.position
	event.relative = Vector2(action.get("relative_x", 0), action.get("relative_y", 0))
	Input.parse_input_event(event)

func _inject_action(action: Dictionary) -> String:
	var action_name = action.get("action", "")
	if action_name == "":
		return "action name is required"

	var pressed = action.get("pressed", true)
	var strength = action.get("strength", 1.0)

	if pressed:
		Input.action_press(action_name, strength)
	else:
		Input.action_release(action_name)
	return ""

func _inject_click_element(action: Dictionary) -> String:
	var identifier: String = action.get("element", "")
	if identifier == "":
		return "element identifier is required"

	var target := _find_control_by_identifier(identifier)
	if target == null:
		return "Could not find UI element: %s" % identifier

	if not target.is_visible_in_tree():
		return "UI element '%s' is not visible" % identifier

	var button_result := _resolve_button_name(action.get("button", "left"))
	if button_result[1] != "":
		return button_result[1]
	var button_index = button_result[0]
	var double_click = action.get("double_click", false)
	var rect := target.get_global_rect()
	var center := rect.get_center()

	var press := InputEventMouseButton.new()
	press.button_index = button_index
	press.pressed = true
	press.position = center
	press.global_position = center
	press.doubleclick = double_click
	Input.parse_input_event(press)

	var release := InputEventMouseButton.new()
	release.button_index = button_index
	release.pressed = false
	release.position = center
	release.global_position = center
	Input.parse_input_event(release)

	# Direct programmatic click fallback when in background mode
	if OS.get_environment("MCP_BACKGROUND") == "1":
		if target.has_method("_gui_input"):
			target._gui_input(press)
			target._gui_input(release)
		if target is BaseButton and not target.disabled:
			target.emit_signal("pressed")

	return ""

# --- UI Element Discovery ---

func _handle_get_ui_elements(peer: PeerState, payload: Dictionary) -> void:
	var visible_only = payload.get("visible_only", true)
	var type_filter = payload.get("type_filter", "")
	var root := get_tree().root
	var elements = []
	_collect_control_nodes(root, elements, visible_only, type_filter)
	_send_response(peer, {"elements": elements})

func _collect_control_nodes(node: Node, elements: Array, visible_only: bool, type_filter: String = "") -> void:
	if node is Control:
		var ctrl := node as Control
		if visible_only and not ctrl.is_visible_in_tree():
			return
		if type_filter != "" and not ctrl.is_class(type_filter):
			# Still recurse into children even if this node doesn't match
			for child in node.get_children():
				_collect_control_nodes(child, elements, visible_only, type_filter)
			return
		var rect := ctrl.get_global_rect()
		var element := {
			"name": String(ctrl.name),
			"type": ctrl.get_class(),
			"path": str(ctrl.get_path()),
			"rect": {
				"x": rect.position.x,
				"y": rect.position.y,
				"width": rect.size.x,
				"height": rect.size.y,
			},
			"visible": ctrl.is_visible_in_tree(),
		}
		# Extract text content for common Control types
		if ctrl is Button:
			element["text"] = (ctrl as Button).text
		elif ctrl is Label:
			element["text"] = (ctrl as Label).text
		elif ctrl is LineEdit:
			element["text"] = (ctrl as LineEdit).text
			element["placeholder"] = (ctrl as LineEdit).placeholder_text
		elif ctrl is TextEdit:
			element["text"] = (ctrl as TextEdit).text
		elif ctrl is RichTextLabel:
			element["text"] = (ctrl as RichTextLabel).text
		# Disabled state for buttons
		if ctrl is BaseButton:
			element["disabled"] = (ctrl as BaseButton).disabled
		# Tooltip
		if ctrl.hint_tooltip != "":
			element["tooltip"] = ctrl.hint_tooltip
		elements.append(element)
	for child in node.get_children():
		_collect_control_nodes(child, elements, visible_only, type_filter)

func _find_control_by_identifier(identifier: String) -> Control:
	var root := get_tree().root
	# Try as node path first
	if identifier.begins_with("/"):
		var abs_node := root.get_node_or_null(NodePath(identifier))
		if abs_node is Control:
			return abs_node as Control
	# Try as relative path from root
	var node := root.get_node_or_null(NodePath(identifier))
	if node is Control:
		return node as Control
	# BFS: match by node name
	var queue = []
	queue.append(root)
	while queue.size() > 0:
		var current: Node = queue.pop_front()
		if current is Control:
			if String(current.name) == identifier:
				return current as Control
		for child in current.get_children():
			queue.append(child)
	return null

# --- Script Execution ---

func _handle_run_script(peer: PeerState, payload: Dictionary) -> void:
	var source: String = payload.get("source", "")
	if source.strip_edges() == "":
		_send_response(peer, {"error": "No script source provided"})
		return

	# Compile the script at runtime
	var script := GDScript.new()
	script.source_code = source
	var err := script.reload()
	if err != OK:
		_send_response(peer, {"error": "Script compilation failed (error %d). Check syntax." % err})
		return

	# Instantiate and validate
	var instance = script.new()
	if instance == null:
		_send_response(peer, {"error": "Failed to instantiate script"})
		return

	if not instance.has_method("execute"):
		if instance is Reference:
			instance = null  # Let Reference free itself
		else:
			instance.free()
		_send_response(peer, {"error": "Script must define func execute(scene_tree: SceneTree) -> Variant"})
		return

	# Execute and yield if the user's script returns a GDScriptFunctionState.
	var result = instance.execute(get_tree())
	if result is GDScriptFunctionState:
		result = yield(result, "completed")

	# Clean up
	if instance is Reference:
		instance = null
	else:
		instance.free()

	# Serialize and respond
	var serialized = _serialize_value(result)
	_send_response(peer, {"success": true, "result": serialized})

func _serialize_value(value):
	if value == null:
		return null

	match typeof(value):
		TYPE_BOOL, TYPE_INT, TYPE_REAL, TYPE_STRING:
			return value
		TYPE_VECTOR2:
			var v: Vector2 = value
			return {"x": v.x, "y": v.y}
		TYPE_VECTOR3:
			var v: Vector3 = value
			return {"x": v.x, "y": v.y, "z": v.z}
		TYPE_COLOR:
			var c: Color = value
			return {"r": c.r, "g": c.g, "b": c.b, "a": c.a}
		TYPE_DICTIONARY:
			var d: Dictionary = value
			var result := {}
			for key in d:
				result[str(key)] = _serialize_value(d[key])
			return result
		TYPE_ARRAY:
			var a: Array = value
			var result := []
			for item in a:
				result.append(_serialize_value(item))
			return result
		TYPE_OBJECT:
			if value is Node:
				var node: Node = value
				return {"class": node.get_class(), "name": String(node.name), "path": str(node.get_path())}
			elif value is Resource:
				var res: Resource = value
				return {"class": res.get_class(), "path": res.resource_path}
			else:
				return str(value)
		_:
			return str(value)

# --- Shutdown ---

func _handle_shutdown(peer: PeerState) -> void:
	_shutting_down = true
	_send_response(peer, {"status": "shutting_down"})
	# Let the response flush before we tear the listener down. A new command
	# arriving in this 2-frame window would dispatch against a peer that's
	# about to close; the response write fails gracefully and the Node side
	# sees BridgeDisconnectedError. MCP serializes calls so this is theoretical.
	yield(get_tree(), "idle_frame")
	yield(get_tree(), "idle_frame")
	_close_all_peers()
	if tcp_server != null:
		tcp_server.stop()
	# Detach from the tree so subsequent _process ticks don't run.
	queue_free()

# --- Utility ---

func _send_response(peer: PeerState, data: Dictionary) -> void:
	var resp := to_json(data)
	var body := resp.to_utf8()
	if body.size() > MAX_FRAME_BYTES:
		push_error("McpBridge: Response exceeds %d bytes; dropping" % MAX_FRAME_BYTES)
		peer.handling = false
		return
	if peer.stream != null and peer.stream.get_status() == StreamPeerTCP.STATUS_CONNECTED:
		var header := PoolByteArray()
		header.resize(FRAME_HEADER_BYTES)
		var size := body.size()
		header[0] = (size >> 24) & 0xFF
		header[1] = (size >> 16) & 0xFF
		header[2] = (size >> 8) & 0xFF
		header[3] = size & 0xFF
		peer.stream.put_data(header)
		peer.stream.put_data(body)
	peer.handling = false

func _close_all_peers() -> void:
	for peer in _peers:
		if peer.stream != null:
			peer.stream.disconnect_from_host()
			peer.stream = null
	_peers.clear()

func _exit_tree() -> void:
	if not _shutting_down:
		push_warning("McpBridge: removed from tree without shutdown - bridge connection will be lost")
	_close_all_peers()
	if tcp_server != null:
		tcp_server.stop()
		tcp_server = null
		print("McpBridge: Stopped")

# --- Spatial Collision & Ground Raycasting Tools ---

func _get_space_state():
	var vp = get_viewport()
	if vp and vp.has_method("find_world"):
		var world = vp.find_world()
		if world:
			return world.direct_space_state
	var spatial = _find_spatial(get_tree().root)
	if spatial:
		var world = spatial.get_world()
		if world:
			return world.direct_space_state
	return null

func _find_spatial(node: Node):
	if node is Spatial:
		return node
	for i in range(node.get_child_count()):
		var found = _find_spatial(node.get_child(i))
		if found:
			return found
	return null

func _find_node_by_name(root: Node, name: String) -> Node:
	if String(root.name) == name:
		return root
	for i in range(root.get_child_count()):
		var found = _find_node_by_name(root.get_child(i), name)
		if found:
			return found
	return null

func _handle_query_spatial_collision(peer: PeerState, payload: Dictionary) -> void:
	var space_state = _get_space_state()
	if space_state == null:
		_send_response(peer, {"error": "No 3D physics space state found"})
		return

	var origin_data = payload.get("origin")
	var dest_data = payload.get("destination")
	if not origin_data or not dest_data:
		_send_response(peer, {"error": "origin and destination are required"})
		return

	var origin = Vector3(float(origin_data.get("x", 0.0)), float(origin_data.get("y", 0.0)), float(origin_data.get("z", 0.0)))
	var dest = Vector3(float(dest_data.get("x", 0.0)), float(dest_data.get("y", 0.0)), float(dest_data.get("z", 0.0)))
	var collision_mask = int(payload.get("collision_mask", 1))

	var exclude = []
	var exclude_paths = payload.get("exclude_bodies", [])
	for path in exclude_paths:
		var node = get_tree().root.get_node_or_null(NodePath(path))
		if not node:
			node = _find_node_by_name(get_tree().root, path)
		if node:
			exclude.append(node)

	var hit = space_state.intersect_ray(origin, dest, exclude, collision_mask, true, false)
	if hit.empty():
		_send_response(peer, {"collided": false})
	else:
		var col_node = hit.get("collider")
		var col_name = ""
		var col_path = ""
		if col_node:
			col_name = String(col_node.name)
			col_path = String(col_node.get_path())
		
		var normal = hit.get("normal")
		var position = hit.get("position")
		_send_response(peer, {
			"collided": true,
			"position": {"x": position.x, "y": position.y, "z": position.z},
			"normal": {"x": normal.x, "y": normal.y, "z": normal.z},
			"collider_name": col_name,
			"collider_path": col_path,
			"collider_id": int(hit.get("collider_id", 0))
		})

func _handle_get_ground_clamp(peer: PeerState, payload: Dictionary) -> void:
	var space_state = _get_space_state()
	if space_state == null:
		_send_response(peer, {"error": "No 3D physics space state found"})
		return

	var pos_data = payload.get("position")
	if not pos_data:
		_send_response(peer, {"error": "position is required"})
		return

	var px = float(pos_data.get("x", 0.0))
	var pz = float(pos_data.get("z", pos_data.get("y", 0.0)))
	
	var max_height = float(payload.get("max_height", 100.0))
	var min_height = float(payload.get("min_height", -100.0))
	var collision_mask = int(payload.get("collision_mask", 1))

	var origin = Vector3(px, max_height, pz)
	var dest = Vector3(px, min_height, pz)

	var hit = space_state.intersect_ray(origin, dest, [], collision_mask, true, false)
	if hit.empty():
		_send_response(peer, {"collided": false})
	else:
		var col_node = hit.get("collider")
		var col_name = ""
		var col_path = ""
		if col_node:
			col_name = String(col_node.name)
			col_path = String(col_node.get_path())
		
		var normal = hit.get("normal")
		var position = hit.get("position")
		_send_response(peer, {
			"collided": true,
			"ground_height": position.y,
			"position": {"x": position.x, "y": position.y, "z": position.z},
			"normal": {"x": normal.x, "y": normal.y, "z": normal.z},
			"collider_name": col_name,
			"collider_path": col_path
		})

func _handle_record_telemetry_sequence(peer: PeerState, payload: Dictionary) -> void:
	var target_path = payload.get("target_node_path", "")
	if target_path == "":
		_send_response(peer, {"error": "target_node_path is required"})
		return

	var duration = float(payload.get("duration", 2.0))
	var interval = float(payload.get("interval", 0.2))
	var capture_screenshots = bool(payload.get("capture_screenshots", false))

	var node = get_tree().root.get_node_or_null(NodePath(target_path))
	if not node:
		node = _find_node_by_name(get_tree().root, target_path)
	if not node:
		_send_response(peer, {"error": "Node not found: %s" % target_path})
		return

	var is_spatial = node is Spatial
	var is_node2d = node is Node2D

	var samples = []
	var elapsed = 0.0
	var timestamp_str := str(OS.get_unix_time()).replace(".", "_")

	var telemetry_dir := ProjectSettings.globalize_path("res://.mcp/telemetry")
	var screenshot_dir := telemetry_dir.plus_file("screenshots")
	var dir = Directory.new()
	var dir_err = dir.make_dir_recursive(screenshot_dir)
	if dir_err != OK:
		_send_response(peer, {"error": "Failed to create telemetry directories (error %d)" % dir_err})
		return

	var steps = int(max(1, ceil(duration / interval)))
	for step in range(steps):
		if not is_instance_valid(node):
			break

		var sample = {
			"elapsed_time": elapsed,
			"timestamp": OS.get_unix_time()
		}

		if is_spatial:
			var s_node = node as Spatial
			var pos = s_node.global_transform.origin
			var rot = s_node.global_transform.basis.get_euler()
			var scale = s_node.global_transform.basis.get_scale()
			sample["position"] = {"x": pos.x, "y": pos.y, "z": pos.z}
			sample["rotation"] = {"x": rot.x, "y": rot.y, "z": rot.z}
			sample["scale"] = {"x": scale.x, "y": scale.y, "z": scale.z}
			if s_node.has_method("get_linear_velocity"):
				var lv = s_node.call("get_linear_velocity")
				sample["linear_velocity"] = {"x": lv.x, "y": lv.y, "z": lv.z}
			if s_node.has_method("get_angular_velocity"):
				var av = s_node.call("get_angular_velocity")
				sample["angular_velocity"] = {"x": av.x, "y": av.y, "z": av.z}
		elif is_node2d:
			var n2d_node = node as Node2D
			var pos = n2d_node.global_position
			var rot = n2d_node.global_rotation
			var scale = n2d_node.global_scale
			sample["position"] = {"x": pos.x, "y": pos.y}
			sample["rotation"] = rot
			sample["scale"] = {"x": scale.x, "y": scale.y}
			if n2d_node.has_method("get_linear_velocity"):
				var lv = n2d_node.call("get_linear_velocity")
				sample["linear_velocity"] = {"x": lv.x, "y": lv.y}
			if n2d_node.has_method("get_angular_velocity"):
				sample["angular_velocity"] = n2d_node.call("get_angular_velocity")

		if capture_screenshots:
			yield(VisualServer, "frame_post_draw")
			var viewport := get_viewport()
			if viewport:
				var image := viewport.get_texture().get_data()
				if image:
					image.flip_y()
					var shot_name = "shot_%s_step_%d.png" % [timestamp_str, step]
					var shot_path = screenshot_dir.plus_file(shot_name)
					var save_err = image.save_png(shot_path)
					if save_err == OK:
						sample["screenshot"] = shot_path.replace("\\", "/")

		samples.append(sample)
		elapsed += interval
		yield(get_tree().create_timer(interval), "timeout")

	var response_data = {
		"node_path": String(node.get_path()),
		"node_name": String(node.name),
		"samples": samples
	}

	# Save sequence as JSON file
	var file_name = "telemetry_%s.json" % timestamp_str
	var file_path = telemetry_dir.plus_file(file_name)
	var file = File.new()
	var open_err = file.open(file_path, File.WRITE)
	if open_err == OK:
		file.store_string(JSON.print(response_data, "  "))
		file.close()
		response_data["saved_file_path"] = file_path.replace("\\", "/")

	_send_response(peer, response_data)

func _find_navigation_node(root: Node) -> Node:
	if root is Navigation:
		return root
	if root.get_class() == "Navigation" or root.get_class() == "Navigation3D":
		return root
	for i in range(root.get_child_count()):
		var found = _find_navigation_node(root.get_child(i))
		if found:
			return found
	return null

func _handle_navigate_to(peer: PeerState, payload: Dictionary) -> void:
	var target_path = payload.get("target_node_path", "")
	if target_path == "":
		_send_response(peer, {"error": "target_node_path is required"})
		return

	var node = get_tree().root.get_node_or_null(NodePath(target_path))
	if not node:
		node = _find_node_by_name(get_tree().root, target_path)
	if not node:
		_send_response(peer, {"error": "Target node not found: %s" % target_path})
		return

	if not (node is Spatial):
		_send_response(peer, {"error": "Target node is not a Spatial (3D) node"})
		return

	var s_node = node as Spatial
	var dest_data = payload.get("destination")
	if not dest_data:
		_send_response(peer, {"error": "destination is required"})
		return

	var dest = Vector3(float(dest_data.get("x", 0.0)), float(dest_data.get("y", 0.0)), float(dest_data.get("z", 0.0)))
	var speed = float(payload.get("speed", 5.0))
	var tolerance = float(payload.get("tolerance", 1.0))
	var timeout = float(payload.get("timeout", 10.0))

	var nav_node: Node = null
	var nav_path = payload.get("navigation_node_path", "")
	if nav_path != "":
		nav_node = get_tree().root.get_node_or_null(NodePath(nav_path))
		if not nav_node:
			nav_node = _find_node_by_name(get_tree().root, nav_path)
	if not nav_node:
		nav_node = _find_navigation_node(get_tree().root)

	var path := PoolVector3Array()
	var path_computed = false
	if nav_node and nav_node.has_method("get_simple_path"):
		path = nav_node.get_simple_path(s_node.global_transform.origin, dest, true)
		if path.size() > 0:
			path_computed = true

	if not path_computed or path.size() == 0:
		path = PoolVector3Array([dest])

	var current_point_idx = 0
	var elapsed = 0.0
	var initial_pos = s_node.global_transform.origin
	var final_pos = initial_pos

	while current_point_idx < path.size():
		var target_point = path[current_point_idx]
		yield(get_tree(), "physics_frame")
		var dt = get_physics_process_delta_time()
		if dt <= 0.0:
			dt = 0.016
		elapsed += dt

		if elapsed >= timeout:
			break

		if not is_instance_valid(s_node):
			_send_response(peer, {"error": "Target node was destroyed during movement"})
			return

		var current_pos = s_node.global_transform.origin
		var to_target = target_point - current_pos
		var dist = to_target.length()

		if dist <= tolerance:
			current_point_idx += 1
			continue

		var dir = to_target.normalized()
		var move_step = dir * speed * dt

		if s_node.has_method("move_and_slide"):
			s_node.call("move_and_slide", dir * speed)
		elif s_node.has_method("set_linear_velocity"):
			s_node.call("set_linear_velocity", dir * speed)
		else:
			if move_step.length() >= dist:
				s_node.global_transform.origin = target_point
				current_point_idx += 1
			else:
				s_node.global_transform.origin += move_step

	final_pos = s_node.global_transform.origin if is_instance_valid(s_node) else dest
	var response = {
		"success": current_point_idx >= path.size(),
		"initial_position": {"x": initial_pos.x, "y": initial_pos.y, "z": initial_pos.z},
		"final_position": {"x": final_pos.x, "y": final_pos.y, "z": final_pos.z},
		"elapsed_time": elapsed,
		"path_points_count": path.size(),
		"path_computed": path_computed,
		"timeout_reached": elapsed >= timeout
	}
	_send_response(peer, response)
