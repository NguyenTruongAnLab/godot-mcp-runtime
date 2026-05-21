#!/usr/bin/env -S godot --no-window --script
extends SceneTree

# Debug mode flag
var debug_mode = false

func _init():
	var args = OS.get_cmdline_args()

	# Check for debug flag
	debug_mode = "--debug-godot" in args

	# SceneTree.quit schedules a quit for end-of-frame. Every quit(1) must be
	# followed by `return` to halt the failing path, otherwise control falls
	# through into success-print + scene save.
	# Find the script argument and determine the positions of operation and params
	var script_index = args.find("--script")
	if script_index == -1:
		log_error("Could not find --script argument")
		quit(1)
		return

	var operation_index = script_index + 2
	var params_index = script_index + 3

	if args.size() <= params_index:
		log_error("Usage: godot --no-window --script godot_operations.gd <operation> <json_params>")
		log_error("Not enough command-line arguments provided.")
		quit(1)
		return

	log_debug("All arguments: " + str(args))

	var operation = args[operation_index]
	var params_json = args[params_index]

	log_info("Operation: " + operation)
	log_debug("Params JSON: " + params_json)

	var parse_result = JSON.parse(params_json)
	var params = null

	if parse_result.error == OK:
		params = parse_result.result
	else:
		log_error("Failed to parse JSON parameters: " + params_json)
		log_error("JSON Error: " + parse_result.error_string + " at line " + str(parse_result.error_line))
		quit(1)
		return

	if not params:
		log_error("Failed to parse JSON parameters: " + params_json)
		quit(1)
		return

	log_info("Executing operation: " + operation)

	match operation:
		# Original operations
		"create_scene":
			create_scene(params)
		"add_node":
			add_node(params)
		"load_sprite":
			load_sprite(params)
		"export_mesh_library":
			export_mesh_library(params)
		"save_scene":
			save_scene(params)
		# Node operations (always-array)
		"delete_nodes":
			delete_nodes(params)
		"set_node_properties":
			set_node_properties(params)
		"get_node_properties":
			get_node_properties(params)
		"get_scene_tree":
			get_scene_tree(params)
		"attach_script":
			attach_script(params)
		"duplicate_node":
			duplicate_node(params)
		"get_node_signals":
			get_node_signals(params)
		"connect_signal":
			connect_signal(params)
		"disconnect_signal":
			disconnect_signal(params)
		"validate_resource":
			validate_resource(params)
		"apply_spatial_material":
			apply_spatial_material(params)
		"set_spatial_material":
			set_spatial_material(params)
		"instance_scene":
			instance_scene(params)
		"set_tilemap_cell":
			set_tilemap_cell(params)
		"configure_animation":
			configure_animation(params)
		"get_animation_list":
			ops_get_animation_list(params)
		"set_gridmap_cell":
			set_gridmap_cell(params)
		"setup_control":
			setup_control(params)
		"apply_shader_material":
			apply_shader_material(params)
		"set_node_metadata":
			set_node_metadata(params)
		"get_node_metadata":
			get_node_metadata(params)
		"setup_collision":
			setup_collision(params)
		"add_mesh_instance":
			add_mesh_instance(params)
		"set_physics_layers":
			set_physics_layers(params)
		"get_physics_layers":
			get_physics_layers(params)
		"add_raycast":
			add_raycast(params)
		"setup_camera":
			setup_camera(params)
		"setup_lighting":
			setup_lighting(params)
		"setup_environment":
			setup_environment(params)
		"setup_navigation_3d":
			setup_navigation_3d(params)
		"create_particles_3d":
			create_particles_3d(params)
		"setup_animation_tree":
			setup_animation_tree(params)
		"setup_collision_3d":
			setup_collision_3d(params)
		"setup_joint_3d":
			setup_joint_3d(params)
		"pipe_animation_states":
			pipe_animation_states(params)
		"generate_gui_hierarchy":
			generate_gui_hierarchy(params)
		# Batch operations
		"validate_batch":
			validate_batch(params)
		"batch_scene_operations":
			batch_scene_operations(params)
		_:
			log_error("Unknown operation: " + operation)
			quit(1)
			return

	quit()
	return

# Logging functions
func log_debug(message):
	if debug_mode:
		print("[DEBUG] " + message)

func log_info(message):
	printerr("[INFO] " + message)

func log_error(message):
	printerr("[ERROR] " + message)

# Get a script by name or path
func get_script_by_name(name_of_class):
	if debug_mode:
		printerr("Attempting to get script for class: " + name_of_class)

	if ResourceLoader.exists(name_of_class, "Script"):
		if debug_mode:
			printerr("Resource exists, loading directly: " + name_of_class)
		var script = load(name_of_class) as Script
		if script:
			if debug_mode:
				printerr("Successfully loaded script from path")
			return script
		else:
			printerr("Failed to load script from path: " + name_of_class)
	elif debug_mode:
		printerr("Resource not found, checking global class registry")

	var global_classes = ProjectSettings.get_global_class_list()
	if debug_mode:
		printerr("Searching through " + str(global_classes.size()) + " global classes")

	for global_class in global_classes:
		var found_name_of_class = global_class["class"]
		var found_path = global_class["path"]

		if found_name_of_class == name_of_class:
			if debug_mode:
				printerr("Found matching class in registry: " + found_name_of_class + " at path: " + found_path)
			var script = load(found_path) as Script
			if script:
				if debug_mode:
					printerr("Successfully loaded script from registry")
				return script
			else:
				printerr("Failed to load script from registry path: " + found_path)
				break

	printerr("Could not find script for class: " + name_of_class)
	return null

# Instantiate a class by name
func instantiate_class(name_of_class):
	if name_of_class == "":
		printerr("Cannot instantiate class: name is empty")
		return null

	var result = null
	if debug_mode:
		printerr("Attempting to instantiate class: " + name_of_class)

	if ClassDB.class_exists(name_of_class):
		if debug_mode:
			printerr("Class exists in ClassDB, using ClassDB.instance()")
		if ClassDB.can_instance(name_of_class):
			result = ClassDB.instance(name_of_class)
			if result == null:
				printerr("ClassDB.instance() returned null for class: " + name_of_class)
		else:
			printerr("Class exists but cannot be instantiated: " + name_of_class)
	else:
		if debug_mode:
			printerr("Class not found in ClassDB, trying to get script")
		var script = get_script_by_name(name_of_class)
		if script is GDScript:
			if debug_mode:
				printerr("Found GDScript, creating instance")
			result = script.new()
		else:
			printerr("Failed to get script for class: " + name_of_class)
			return null

	if result == null:
		printerr("Failed to instantiate class: " + name_of_class)
	elif debug_mode:
		printerr("Successfully instantiated class: " + name_of_class + " of type: " + result.get_class())

	return result

# Helper to normalize scene path
func normalize_scene_path(scene_path: String) -> String:
	if not scene_path.begins_with("res://"):
		return "res://" + scene_path
	return scene_path

func _file_exists(path: String) -> bool:
	var file = File.new()
	return file.file_exists(path)

# Helper to load and instantiate a scene
func load_scene_instance(scene_path: String):
	var full_path = normalize_scene_path(scene_path)
	log_debug("Loading scene from: " + full_path)

	if not _file_exists(full_path):
		log_error("Scene file does not exist: " + full_path)
		return null

	var scene = load(full_path)
	if not scene:
		log_error("Failed to load scene: " + full_path)
		return null

	var instance = scene.instance()
	if not instance:
		log_error("Failed to instantiate scene: " + full_path)
		return null

	return instance

# Helper to find a node by path. Accepts "root", ".", "" (all → scene_root),
# the actual scene root's name (e.g. "Main"), or a path with either as the first
# segment (e.g. "root/Button" or "Main/Button"). Bare paths ("Button") resolve
# normally via get_node_or_null.
func find_node_by_path(scene_root: Node, node_path: String) -> Node:
	if node_path == "" or node_path == "." or node_path == "root":
		return scene_root
	if node_path == String(scene_root.name):
		return scene_root

	var path = node_path
	var first_slash = path.find("/")
	if first_slash != -1:
		var first_segment = path.substr(0, first_slash)
		if first_segment == "root" or first_segment == String(scene_root.name):
			path = path.substr(first_slash + 1)

	if path == "":
		return scene_root

	return scene_root.get_node_or_null(path)

# Helper to save a scene
func save_scene_to_path(scene_root: Node, save_path: String) -> bool:
	var full_path = normalize_scene_path(save_path)

	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(scene_root)

	if result != OK:
		log_error("Failed to pack scene: " + str(result))
		return false

	var save_error = ResourceSaver.save(full_path, packed_scene)
	if save_error != OK:
		log_error("Failed to save scene: " + str(save_error))
		return false

	return true

# Ensure the parent directory of a res:// path exists, creating it recursively
# if needed. Returns true on success or when the directory already exists.
func _ensure_res_dir(full_res_path: String) -> bool:
	var dir_path = full_res_path.get_base_dir()
	if dir_path == "res://" or dir_path == "":
		return true
	var dir = Directory.new()
	return dir.make_dir_recursive(dir_path) == OK

# Create a new scene with a specified root node type
func create_scene(params):
	printerr("Creating scene: " + params.scene_path)

	var full_scene_path = normalize_scene_path(params.scene_path)
	log_debug("Scene path: " + full_scene_path)

	var root_node_type = "Node2D"
	if params.has("root_node_type"):
		root_node_type = params.root_node_type
	log_debug("Root node type: " + root_node_type)

	var scene_root = instantiate_class(root_node_type)
	if not scene_root:
		log_error("Failed to instantiate node of type: " + root_node_type)
		quit(1)
		return

	scene_root.name = "root"

	if not _ensure_res_dir(full_scene_path):
		log_error("Failed to create directory for scene: " + full_scene_path)
		quit(1)
		return

	if save_scene_to_path(scene_root, full_scene_path):
		print("Scene created successfully at: " + params.scene_path)
	else:
		log_error("Failed to create scene: " + params.scene_path)
		quit(1)
		return

# Add a node to an existing scene
# Apply an add_node mutation without saving. Shared by standalone add_node
# and batch_scene_operations so both paths validate identically.
# Returns {"ok": bool, "error": String}; error is empty on success.
func _apply_add_node(scene_root: Node, op: Dictionary) -> Dictionary:
	var parent_path = "root"
	if op.has("parent_node_path"):
		parent_path = op.parent_node_path
	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		return {"ok": false, "error": "Parent node not found: " + parent_path}
	if not op.has("node_type") or op.node_type == "":
		return {"ok": false, "error": "node_type is required for add_node"}
	if not op.has("node_name") or op.node_name == "":
		return {"ok": false, "error": "node_name is required for add_node"}
	var new_node = instantiate_class(op.node_type)
	if not new_node:
		return {"ok": false, "error": "Failed to instantiate node of type: " + op.node_type}
	new_node.name = op.node_name
	if op.has("properties"):
		for property in op.properties:
			new_node.set(property, _coerce_property_value(op.properties[property]))
	parent.add_child(new_node)
	new_node.owner = scene_root
	return {"ok": true, "error": ""}

# Apply a load_sprite mutation without saving. Shared by standalone load_sprite
# and batch_scene_operations.
func _apply_load_sprite(scene_root: Node, op: Dictionary) -> Dictionary:
	if not op.has("node_path") or op.node_path == "":
		return {"ok": false, "error": "node_path is required for load_sprite"}
	if not op.has("texture_path") or op.texture_path == "":
		return {"ok": false, "error": "texture_path is required for load_sprite"}
	var sprite_node = find_node_by_path(scene_root, op.node_path)
	if not sprite_node:
		return {"ok": false, "error": "Node not found: " + op.node_path}
	if not (sprite_node is Sprite or sprite_node is Sprite3D or sprite_node is TextureRect):
		return {"ok": false, "error": "Node is not a sprite-compatible type: " + sprite_node.get_class()}
	var full_texture_path = normalize_scene_path(op.texture_path)
	var texture = load(full_texture_path)
	if not texture:
		return {"ok": false, "error": "Failed to load texture: " + full_texture_path}
	if not (texture is Texture):
		return {"ok": false, "error": "Loaded resource is not a Texture: " + full_texture_path}
	# A texture without a resource_path is a runtime-only object - PackedScene.pack()
	# cannot serialize it, so the assignment would silently vanish on save.
	if texture.resource_path == "":
		return {"ok": false, "error": "Texture has no resource_path - likely not imported. Open project in Godot editor once, or run 'godot --headless --editor --quit' to import assets."}
	sprite_node.texture = texture
	return {"ok": true, "error": ""}

func add_node(params):
	printerr("Adding node to scene: " + params.scene_path)

	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var result = _apply_add_node(scene_root, params)
	if not result.ok:
		log_error(result.error)
		quit(1)
		return

	if save_scene_to_path(scene_root, params.scene_path):
		print("Node '" + params.node_name + "' of type '" + params.node_type + "' added successfully")
	else:
		log_error("Failed to save scene after adding node")
		quit(1)
		return

# Load a sprite into a Sprite node
func load_sprite(params):
	printerr("Loading sprite into scene: " + params.scene_path)

	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var result = _apply_load_sprite(scene_root, params)
	if not result.ok:
		log_error(result.error)
		quit(1)
		return

	if save_scene_to_path(scene_root, params.scene_path):
		print("Sprite loaded successfully with texture: " + params.texture_path)
	else:
		log_error("Failed to save scene after loading sprite")
		quit(1)
		return

# Export a scene as a MeshLibrary resource
func export_mesh_library(params):
	printerr("Exporting MeshLibrary from scene: " + params.scene_path)

	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var mesh_library = MeshLibrary.new()

	var mesh_item_names = params.mesh_item_names if params.has("mesh_item_names") else []
	var use_specific_items = mesh_item_names.size() > 0

	var item_id = 0

	for child in scene_root.get_children():
		if use_specific_items and not (child.name in mesh_item_names):
			continue

		var mesh_instance = null
		if child is MeshInstance:
			mesh_instance = child
		else:
			for descendant in child.get_children():
				if descendant is MeshInstance:
					mesh_instance = descendant
					break

		if mesh_instance and mesh_instance.mesh:
			mesh_library.create_item(item_id)
			mesh_library.set_item_name(item_id, child.name)
			mesh_library.set_item_mesh(item_id, mesh_instance.mesh)

			for collision_child in child.get_children():
				if collision_child is CollisionShape and collision_child.shape:
					mesh_library.set_item_shapes(item_id, [collision_child.shape])
					break

			mesh_library.set_item_preview(item_id, mesh_instance.mesh)

			item_id += 1

	if item_id > 0:
		var full_output_path = normalize_scene_path(params.output_path)

		if not _ensure_res_dir(full_output_path):
			log_error("Failed to create directory for MeshLibrary: " + full_output_path)
			quit(1)
			return

		var error = ResourceSaver.save(mesh_library, full_output_path)
		if error == OK:
			print("MeshLibrary exported successfully with " + str(item_id) + " items to: " + params.output_path)
		else:
			log_error("Failed to save MeshLibrary: " + str(error))
			quit(1)
			return
	else:
		log_error("No valid meshes found in the scene")
		quit(1)
		return

# Save changes to a scene file
func save_scene(params):
	printerr("Saving scene: " + params.scene_path)

	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var save_path = params.new_path if params.has("new_path") else params.scene_path

	if save_scene_to_path(scene_root, save_path):
		print("Scene saved successfully to: " + save_path)
	else:
		log_error("Failed to save scene")
		quit(1)
		return

# ============================================
# NODE OPERATIONS
# ============================================

# Delete one or more nodes from a scene (saves once)
func delete_nodes(params):
	printerr("Deleting nodes from scene: " + params.scene_path)

	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node_paths: Array = params.node_paths
	var results: Array = []
	var any_deleted := false

	for node_path in node_paths:
		var entry = {"nodePath": node_path}
		var node = find_node_by_path(scene_root, node_path)
		if not node:
			entry["error"] = "Node not found: " + node_path
		elif node == scene_root:
			entry["error"] = "Cannot delete the root node"
		else:
			var parent = node.get_parent()
			parent.remove_child(node)
			node.queue_free()
			entry["success"] = true
			any_deleted = true
		results.append(entry)

	if any_deleted:
		if not save_scene_to_path(scene_root, params.scene_path):
			print(to_json({"error": "Failed to save scene after deleting nodes", "results": results}))
			return

	print(to_json({"results": results}))

# Update one or more node properties in a single headless process (saves once)
func set_node_properties(params: Dictionary) -> void:
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		print(to_json({"error": "Failed to load scene: " + params.scene_path, "results": []}))
		return

	var abort_on_error = params.get("abort_on_error", false)
	var results: Array = []
	var any_set := false

	for update in params.updates:
		var result = {"nodePath": update.node_path, "property": update.property}
		var node = find_node_by_path(scene_root, update.node_path)
		if node == null:
			result["error"] = "Node not found: " + update.node_path
		elif not (update.property in node):
			result["error"] = "Property '%s' does not exist on node of type '%s'" % [update.property, node.get_class()]
		else:
			node.set(update.property, _coerce_property_value(update.value))
			result["success"] = true
			any_set = true
		results.append(result)
		if abort_on_error and result.has("error"):
			break

	if any_set:
		if not save_scene_to_path(scene_root, params.scene_path):
			print(to_json({"error": "Failed to save scene after updates", "results": results}))
			return

	print(to_json({"results": results}))

# Get properties from one or more nodes in a single headless process (loads scene once)
func get_node_properties(params: Dictionary) -> void:
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		print(to_json({"error": "Failed to load scene: " + params.scene_path, "results": []}))
		return

	var results: Array = []
	# Class-name → default-instance cache. Reused across all nodes in this call
	# so we don't instantiate a fresh default per node when changed_only is true.
	var defaults_cache: Dictionary = {}

	for node_spec in params.nodes:
		var node_path = node_spec.get("node_path", "")
		var changed_only = node_spec.get("changed_only", false)
		var node = find_node_by_path(scene_root, node_path)
		if node == null:
			results.append({"nodePath": node_path, "error": "Node not found"})
		else:
			var props = _collect_node_properties(node, changed_only, defaults_cache)
			results.append({"nodePath": node_path, "nodeType": node.get_class(), "properties": props})

	# Free cached default instances; they were created via instantiate_class.
	for klass in defaults_cache:
		var inst = defaults_cache[klass]
		if inst:
			inst.free()

	print(to_json({"results": results}))

# Get full hierarchical tree structure of a scene
func get_scene_tree(params):
	printerr("Getting scene tree for: " + params.scene_path)

	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var tree_root = scene_root
	if params.has("parent_path") and params.parent_path:
		tree_root = find_node_by_path(scene_root, params.parent_path)
		if not tree_root:
			log_error("Parent node not found: " + str(params.parent_path))
			quit(1)
			return

	var max_depth = -1
	if params.has("max_depth"):
		max_depth = int(params.max_depth)

	var tree = build_tree_recursive(tree_root, "", 0, max_depth)
	print(to_json(tree))

func build_tree_recursive(node: Node, path: String, depth: int = 0, max_depth: int = -1) -> Dictionary:
	var node_path = path + "/" + node.name if path != "" else node.name

	var children = []
	if max_depth < 0 or depth < max_depth:
		for child in node.get_children():
			children.append(build_tree_recursive(child, node_path, depth + 1, max_depth))

	var script_path = ""
	var script = node.get_script()
	if script and script.resource_path:
		script_path = script.resource_path

	return {
		"name": node.name,
		"type": node.get_class(),
		"path": node_path,
		"script": script_path,
		"children": children
	}

# Attach or change a script on a node
func attach_script(params):
	printerr("Attaching script to node in scene: " + params.scene_path)

	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	var full_script_path = normalize_scene_path(params.script_path)

	if not _file_exists(full_script_path):
		log_error("Script file does not exist: " + full_script_path)
		quit(1)
		return

	var script = load(full_script_path)
	if not script:
		log_error("Failed to load script: " + full_script_path)
		quit(1)
		return

	node.set_script(script)

	if save_scene_to_path(scene_root, params.scene_path):
		print("Script '" + params.script_path + "' attached successfully to node '" + params.node_path + "'")
	else:
		log_error("Failed to save scene after attaching script")
		quit(1)
		return

# ============================================
# SIGNAL AND DUPLICATE OPERATIONS
# ============================================

# Duplicate a node and its children within a scene
func duplicate_node(params):
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return
	if node == scene_root:
		log_error("Cannot duplicate the root node")
		quit(1)
		return

	var duplicate = node.duplicate()
	if params.has("new_name"):
		duplicate.name = params.new_name
	else:
		duplicate.name = node.name + "2"

	var parent = node.get_parent()
	if params.has("target_parent_path"):
		parent = find_node_by_path(scene_root, params.target_parent_path)
		if not parent:
			log_error("Target parent not found: " + params.target_parent_path)
			quit(1)
			return

	parent.add_child(duplicate)
	duplicate.owner = scene_root
	# Iterative BFS to set owner on all descendants - avoids recursion depth.
	var queue: Array = duplicate.get_children()
	while queue.size() > 0:
		var current = queue.pop_front()
		current.owner = scene_root
		queue.append_array(current.get_children())

	if save_scene_to_path(scene_root, params.scene_path):
		print("Node duplicated successfully as '" + duplicate.name + "'")
	else:
		log_error("Failed to save scene after duplicating node")
		quit(1)
		return

# List signals defined on a node and their current connections
func get_node_signals(params):
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	var signals = []
	for sig in node.get_signal_list():
		var sig_name = sig["name"]
		var connections = []
		for conn in node.get_signal_connection_list(sig_name):
			var target_obj = conn.get("target", null)
			var target_path = "unknown"
			if target_obj:
				target_path = str(target_obj.get_path())
			connections.append({
				"signal": sig_name,
				"target": target_path,
				"method": conn.get("method", "")
			})
		signals.append({
			"name": sig_name,
			"connections": connections
		})

	print(to_json({
		"nodePath": params.node_path,
		"nodeType": node.get_class(),
		"signals": signals
	}))

# Connect a signal from one node to a method on another node
func connect_signal(params):
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var source = find_node_by_path(scene_root, params.node_path)
	if not source:
		log_error("Source node not found: " + params.node_path)
		quit(1)
		return

	var target = find_node_by_path(scene_root, params.target_node_path)
	if not target:
		log_error("Target node not found: " + params.target_node_path)
		quit(1)
		return

	if not source.has_signal(params.signal):
		log_error("Signal does not exist: " + params.signal + " on " + source.get_class())
		quit(1)
		return

	if not target.has_method(params.method):
		log_error("Method does not exist: " + params.method + " on " + target.get_class())
		quit(1)
		return

	# CONNECT_PERSIST is required for the connection to be serialized into the
	# packed scene; without it the connection is runtime-only and disappears on save.
	var err = source.connect(params.signal, target, params.method, [], CONNECT_PERSIST)
	if err != OK:
		log_error("Failed to connect signal: " + str(err))
		quit(1)
		return

	if save_scene_to_path(scene_root, params.scene_path):
		print("Signal '" + params.signal + "' connected from '" + params.node_path + "' to '" + params.target_node_path + "." + params.method + "'")
	else:
		log_error("Failed to save scene after connecting signal")
		quit(1)
		return

# Disconnect a signal connection between two nodes
func disconnect_signal(params):
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var source = find_node_by_path(scene_root, params.node_path)
	if not source:
		log_error("Source node not found: " + params.node_path)
		quit(1)
		return

	var target = find_node_by_path(scene_root, params.target_node_path)
	if not target:
		log_error("Target node not found: " + params.target_node_path)
		quit(1)
		return

	if not source.is_connected(params.signal, target, params.method):
		log_error("Signal connection does not exist")
		quit(1)
		return

	source.disconnect(params.signal, target, params.method)

	if save_scene_to_path(scene_root, params.scene_path):
		print("Signal '" + params.signal + "' disconnected from '" + params.target_node_path + "." + params.method + "'")
	else:
		log_error("Failed to save scene after disconnecting signal")
		quit(1)
		return

# Assign a material resource to a MeshInstance (saves once)
func apply_spatial_material(params):
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	if not (node is MeshInstance):
		log_error("Node is not a MeshInstance: " + params.node_path)
		quit(1)
		return

	var material_path = params.material_path
	if not material_path.begins_with("res://"):
		material_path = "res://" + material_path

	var material = load(material_path)
	if not material:
		log_error("Failed to load material resource: " + material_path)
		quit(1)
		return

	var surface_index = int(params.get("surface_index", -1))
	if surface_index >= 0:
		node.set_surface_material(surface_index, material)
		printerr("Assigned material " + material_path + " to surface " + str(surface_index))
	else:
		node.material_override = material
		printerr("Assigned material_override " + material_path + " to node " + params.node_path)

	if save_scene_to_path(scene_root, params.scene_path):
		print("Material successfully applied to scene node")
	else:
		log_error("Failed to save scene after applying material")
		quit(1)
		return

func _load_texture_helper(path):
	var t_path = path
	if not t_path.begins_with("res://"):
		t_path = "res://" + t_path
	var tex = load(t_path)
	if not tex:
		log_error("Failed to load texture at path: " + t_path)
		quit(1)
		return null
	return tex

# Creates or configures a SpatialMaterial on a MeshInstance inside a scene (saves once)
func set_spatial_material(params):
	printerr("Setting spatial material in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	if not (node is MeshInstance):
		log_error("Node is not a MeshInstance: " + params.node_path)
		quit(1)
		return

	var mesh_instance = node as MeshInstance
	var surface_index = int(params.get("surface_index", -1))
	var material = null

	if surface_index >= 0:
		material = mesh_instance.get_surface_material(surface_index)
	else:
		material = mesh_instance.material_override

	if not material or not (material is SpatialMaterial):
		if ClassDB.can_instance("StandardMaterial3D"):
			material = ClassDB.instance("StandardMaterial3D")
		else:
			material = SpatialMaterial.new()

	if params.has("albedo_color"):
		var color = _coerce_property_value(params.albedo_color)
		if color is Color:
			material.albedo_color = color

	if params.has("albedo_texture") and params.albedo_texture != "":
		var tex = _load_texture_helper(params.albedo_texture)
		if tex:
			material.albedo_texture = tex

	if params.has("metallic"):
		material.metallic = float(params.metallic)

	if params.has("roughness"):
		material.roughness = float(params.roughness)

	if params.has("metallic_texture") and params.metallic_texture != "":
		var tex = _load_texture_helper(params.metallic_texture)
		if tex:
			material.metallic_texture = tex

	if params.has("roughness_texture") and params.roughness_texture != "":
		var tex = _load_texture_helper(params.roughness_texture)
		if tex:
			material.roughness_texture = tex

	if params.has("normal_enabled"):
		var norm_en = bool(params.normal_enabled)
		if "normal_enabled" in material:
			material.normal_enabled = norm_en

	if params.has("normal_texture") and params.normal_texture != "":
		var tex = _load_texture_helper(params.normal_texture)
		if tex:
			material.normal_texture = tex

	if params.has("normal_scale"):
		if "normal_scale" in material:
			material.normal_scale = float(params.normal_scale)

	if params.has("transparency"):
		var transp = bool(params.transparency)
		if "flags_transparent" in material:
			material.flags_transparent = transp
		elif "transparency" in material:
			material.transparency = 1 if transp else 0

	if params.has("cull_mode"):
		var cull_str = String(params.cull_mode).to_lower()
		var cull_val = 0
		if cull_str == "front":
			cull_val = 1
		elif cull_str == "disabled" or cull_str == "none":
			cull_val = 2
		if "params_cull_mode" in material:
			material.params_cull_mode = cull_val
		elif "cull_mode" in material:
			material.cull_mode = cull_val

	# Reassign material to node
	if surface_index >= 0:
		mesh_instance.set_surface_material(surface_index, material)
	else:
		mesh_instance.material_override = material

	if save_scene_to_path(scene_root, params.scene_path):
		var target_str = "surface " + str(surface_index) if surface_index >= 0 else "material_override"
		print("SpatialMaterial successfully configured and applied to " + target_str + " on node " + params.node_path)
	else:
		log_error("Failed to save scene after configuring spatial material")
		quit(1)
		return

# ============================================================
# VALIDATE OPERATION
# ============================================

# Validate a GDScript or scene file by loading it headlessly
func validate_resource(params):
	if not (params.has("script_path") or params.has("scene_path")):
		log_error("validate_resource requires script_path or scene_path")
		quit(1)
		return
	var result = _validate_single(params)
	print(to_json({"valid": result.valid, "errors": result.errors}))

# ============================================
# BATCH OPERATIONS
# ============================================

# Helper: coerce a JSON-parsed value to a GDScript type (Vector2, Vector3, Color)
func _coerce_property_value(value):
	if typeof(value) == TYPE_DICTIONARY:
		if value.has("x") and value.has("y"):
			if value.has("z"):
				return Vector3(value.x, value.y, value.z)
			else:
				return Vector2(value.x, value.y)
		elif value.has("r") and value.has("g") and value.has("b"):
			var a = value.a if value.has("a") else 1.0
			return Color(value.r, value.g, value.b, a)
	elif typeof(value) == TYPE_STRING:
		var s: String = value.strip_edges()
		if s.begins_with("#"):
			return Color(s)
		if s.begins_with("Vector2(") or s.begins_with("Vector3(") or s.begins_with("Color(") or s.begins_with("Rect2(") or s.begins_with("Transform(") or s.begins_with("Quat(") or s.begins_with("Plane(") or s.begins_with("Basis("):
			var expr = Expression.new()
			var err = expr.parse(s, [])
			if err == OK:
				var res = expr.execute([], null, false)
				if not expr.has_execute_failed():
					return res
	return value

# Helper: collect node properties into a serializable Dictionary. When
# changed_only is true, compares each property against a default instance of
# the node's class. The defaults_cache dict is keyed by class name so the
# caller can reuse default instances across many nodes (caller is responsible
# for freeing the cache when done).
func _collect_node_properties(node: Node, changed_only: bool, defaults_cache: Dictionary) -> Dictionary:
	var default_node = null
	if changed_only:
		var klass = node.get_class()
		if defaults_cache.has(klass):
			default_node = defaults_cache[klass]
		else:
			default_node = instantiate_class(klass)
			defaults_cache[klass] = default_node

	var properties = {}
	var property_list = node.get_property_list()

	for prop in property_list:
		var prop_name = prop["name"]
		var prop_usage = prop["usage"]

		if prop_usage & PROPERTY_USAGE_STORAGE or prop_usage & PROPERTY_USAGE_EDITOR:
			var value = node.get(prop_name)

			if default_node and default_node.get(prop_name) == value:
				continue

			if value is Vector2:
				properties[prop_name] = {"x": value.x, "y": value.y}
			elif value is Vector3:
				properties[prop_name] = {"x": value.x, "y": value.y, "z": value.z}
			elif value is Color:
				properties[prop_name] = {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
			elif value is Transform2D:
				properties[prop_name] = str(value)
			elif value is Transform:
				properties[prop_name] = str(value)
			elif value is Object:
				if value:
					properties[prop_name] = value.get_class()
				else:
					properties[prop_name] = null
			elif typeof(value) in [TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_REAL, TYPE_STRING, TYPE_ARRAY, TYPE_DICTIONARY]:
				properties[prop_name] = value
			else:
				properties[prop_name] = str(value)

	return properties

# Helper: validate a single target dict (script_path or scene_path)
func _validate_single(target: Dictionary) -> Dictionary:
	if target.has("script_path") and target.script_path != "":
		var path = normalize_scene_path(target.script_path)
		if not _file_exists(path):
			return {"valid": false, "errors": [{"message": "File not found: " + path}], "target": target.script_path}
		var resource = load(path)
		# Actual parse errors go to stderr and are parsed by TypeScript
		return {"valid": resource != null, "errors": [], "target": target.script_path}
	elif target.has("scene_path") and target.scene_path != "":
		var path = normalize_scene_path(target.scene_path)
		if not _file_exists(path):
			return {"valid": false, "errors": [{"message": "File not found: " + path}], "target": target.scene_path}
		var scene = load(path)
		return {"valid": scene != null, "errors": [], "target": target.scene_path}
	else:
		return {"valid": false, "errors": [{"message": "No valid target: provide script_path or scene_path"}], "target": ""}

# Validate multiple scripts/scenes in a single headless process
func validate_batch(params: Dictionary) -> void:
	var results: Array = []
	for target in params.targets:
		results.append(_validate_single(target))
	print(to_json({"results": results}))

# Execute multiple scene operations in a single headless process
# Scenes are loaded once and cached in memory; mutations accumulate until a save op
func batch_scene_operations(params: Dictionary) -> void:
	var abort_on_error = params.get("abort_on_error", false)
	var results: Array = []
	var scene_cache: Dictionary = {}

	for op in params.operations:
		var op_name = op.get("operation", "")
		var scene_path = op.get("scene_path", "")
		var result = {"operation": op_name, "scenePath": scene_path}

		if scene_path != "" and not (scene_path in scene_cache):
			var scene_root = load_scene_instance(scene_path)
			if scene_root:
				scene_cache[scene_path] = scene_root
			else:
				result["error"] = "Failed to load scene: " + scene_path
				results.append(result)
				if abort_on_error:
					break
				continue

		var scene_root = scene_cache.get(scene_path, null) if scene_path != "" else null

		match op_name:
			"add_node":
				if scene_root == null:
					result["error"] = "scene_path required for add_node"
				else:
					var apply_result = _apply_add_node(scene_root, op)
					if not apply_result.ok:
						result["error"] = apply_result.error
					else:
						result["success"] = true
			"load_sprite":
				if scene_root == null:
					result["error"] = "scene_path required for load_sprite"
				else:
					var apply_result = _apply_load_sprite(scene_root, op)
					if not apply_result.ok:
						result["error"] = apply_result.error
					else:
						result["success"] = true
			"save":
				if scene_root == null:
					result["error"] = "scene_path required for save"
				else:
					var new_path = op.get("new_path", scene_path)
					if save_scene_to_path(scene_root, new_path):
						result["success"] = true
						# Only evict on normal save; save-as leaves the mutated scene in
						# cache so subsequent ops on scene_path still see accumulated mutations.
						if new_path == scene_path:
							scene_cache.erase(scene_path)
					else:
						result["error"] = "Failed to save scene: " + scene_path
			_:
				result["error"] = "Unknown batch operation: " + op_name

		results.append(result)
		if abort_on_error and result.has("error"):
			break

	# Auto-save any scenes that were mutated but not explicitly saved
	for scene_path in scene_cache:
		save_scene_to_path(scene_cache[scene_path], scene_path)

	print(to_json({"results": results}))

# Instance an existing scene file as a child of a node in a scene (saves once)
func instance_scene(params):
	printerr("Instancing scene: " + params.instance_path + " into " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_node_path") and params.parent_node_path != "":
		parent_path = params.parent_node_path
	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	var full_instance_path = normalize_scene_path(params.instance_path)
	if not _file_exists(full_instance_path):
		log_error("Instance scene file does not exist: " + full_instance_path)
		quit(1)
		return

	var instanced_scene = load(full_instance_path)
	if not instanced_scene:
		log_error("Failed to load scene to instance: " + full_instance_path)
		quit(1)
		return

	var instance = instanced_scene.instance()
	if not instance:
		log_error("Failed to instance scene: " + full_instance_path)
		quit(1)
		return

	if params.has("node_name") and params.node_name != "":
		instance.name = params.node_name

	# Apply properties if any (like position, translation, etc.)
	if params.has("properties"):
		for property in params.properties:
			instance.set(property, _coerce_property_value(params.properties[property]))

	parent.add_child(instance)
	instance.owner = scene_root
	
	# Set owner recursively for all descendants of the instance
	var queue: Array = instance.get_children()
	while queue.size() > 0:
		var current = queue.pop_front()
		current.owner = scene_root
		queue.append_array(current.get_children())

	if save_scene_to_path(scene_root, params.scene_path):
		print("Scene instanced successfully as '" + instance.name + "' under '" + parent_path + "'")
	else:
		log_error("Failed to save scene after instancing")
		quit(1)
		return

# Set a cell in a TileMap node (saves once)
func set_tilemap_cell(params):
	printerr("Setting tilemap cell in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("TileMap node not found: " + params.node_path)
		quit(1)
		return

	if not (node is TileMap):
		log_error("Node is not a TileMap: " + params.node_path)
		quit(1)
		return

	var tile_map = node as TileMap
	var x = int(params.x)
	var y = int(params.y)
	var tile_id = int(params.tile_id)
	var flip_x = bool(params.get("flip_x", false))
	var flip_y = bool(params.get("flip_y", false))
	var transpose = bool(params.get("transpose", false))

	tile_map.set_cell(x, y, tile_id, flip_x, flip_y, transpose)

	if save_scene_to_path(scene_root, params.scene_path):
		print("TileMap cell at (" + str(x) + ", " + str(y) + ") set to tile " + str(tile_id))
	else:
		log_error("Failed to save scene after setting tilemap cell")
		quit(1)
		return

# Configure an animation track and keys in an AnimationPlayer node (saves once)
func configure_animation(params):
	printerr("Configuring animation '" + params.anim_name + "' on " + params.player_path + " in scene " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.player_path)
	if not node:
		log_error("AnimationPlayer node not found: " + params.player_path)
		quit(1)
		return

	if not (node is AnimationPlayer):
		log_error("Node is not an AnimationPlayer: " + params.player_path)
		quit(1)
		return

	var player = node as AnimationPlayer
	var anim_name = params.anim_name
	
	# If the animation already exists, we modify it or create a new one
	var anim = player.get_animation(anim_name) if player.has_animation(anim_name) else null
	if not anim:
		anim = Animation.new()
		player.add_animation(anim_name, anim)
	else:
		# Clear existing tracks to do a clean overwrite/re-configuration
		for i in range(anim.get_track_count() - 1, -1, -1):
			anim.remove_track(i)

	anim.length = float(params.get("length", 1.0))
	anim.loop = bool(params.get("loop", false))

	if params.has("tracks") and typeof(params.tracks) == TYPE_ARRAY:
		for track_spec in params.tracks:
			if not (track_spec.has("node_path") and track_spec.has("property")):
				continue
			var track_idx = anim.add_track(Animation.TYPE_VALUE)
			# Godot 3's NodePath format for animation track is: "node_path:property"
			var full_track_path = String(track_spec.node_path) + ":" + String(track_spec.property)
			anim.track_set_path(track_idx, NodePath(full_track_path))
			
			if track_spec.has("keys") and typeof(track_spec.keys) == TYPE_ARRAY:
				for key_spec in track_spec.keys:
					if not key_spec.has("time") or not key_spec.has("value"):
						continue
					var time = float(key_spec.time)
					var value = _coerce_property_value(key_spec.value)
					anim.track_insert_key(track_idx, time, value)

	if save_scene_to_path(scene_root, params.scene_path):
		print("Animation '" + anim_name + "' configured successfully")
	else:
		log_error("Failed to save scene after configuring animation")
		quit(1)
		return

# List all animations in an AnimationPlayer node
func ops_get_animation_list(params):
	printerr("Listing animations on " + params.player_path + " in scene " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.player_path)
	if not node:
		log_error("AnimationPlayer node not found: " + params.player_path)
		quit(1)
		return

	if not (node is AnimationPlayer):
		log_error("Node is not an AnimationPlayer: " + params.player_path)
		quit(1)
		return

	var player = node as AnimationPlayer
	var animations = []

	for anim_name in player.get_animation_list():
		var anim = player.get_animation(anim_name)
		if anim:
			animations.append({
				"name": anim_name,
				"length": anim.length,
				"loop": anim.loop,
				"trackCount": anim.get_track_count()
			})

	print(to_json({"animations": animations}))

# Set a cell in a GridMap node (saves once)
func set_gridmap_cell(params):
	printerr("Setting gridmap cell in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("GridMap node not found: " + params.node_path)
		quit(1)
		return

	if not (node is GridMap):
		log_error("Node is not a GridMap: " + params.node_path)
		quit(1)
		return

	var grid_map = node as GridMap
	if params.has("cells"):
		var cells = params.cells
		if typeof(cells) == TYPE_ARRAY:
			for cell in cells:
				if typeof(cell) == TYPE_DICTIONARY:
					var cx = int(cell.get("x", 0))
					var cy = int(cell.get("y", 0))
					var cz = int(cell.get("z", 0))
					var citem = int(cell.get("item", -1))
					var corient = int(cell.get("orientation", 0))
					grid_map.set_cell_item(cx, cy, cz, citem, corient)
		else:
			log_error("cells parameter must be an array")
			quit(1)
			return
	else:
		var x = int(params.x)
		var y = int(params.y)
		var z = int(params.z)
		var item = int(params.item)
		var orientation = int(params.get("orientation", 0))
		grid_map.set_cell_item(x, y, z, item, orientation)

	if save_scene_to_path(scene_root, params.scene_path):
		if params.has("cells"):
			print("GridMap successfully set batch cells (" + str(params.cells.size()) + " cells)")
		else:
			var x = int(params.x)
			var y = int(params.y)
			var z = int(params.z)
			var item = int(params.item)
			print("GridMap cell at (" + str(x) + ", " + str(y) + ", " + str(z) + ") set to item " + str(item))
	else:
		log_error("Failed to save scene after setting gridmap cell")
		quit(1)
		return

# Apply a custom Shader to a material on a node (saves once)
func apply_shader_material(params):
	printerr("Applying shader material in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	var shader_path = params.shader_path
	if not shader_path.begins_with("res://"):
		shader_path = "res://" + shader_path

	var shader = load(shader_path)
	if not shader or not (shader is Shader):
		log_error("Failed to load shader: " + shader_path)
		quit(1)
		return

	var mat = ShaderMaterial.new()
	mat.shader = shader
	
	if params.has("shader_params") and typeof(params.shader_params) == TYPE_DICTIONARY:
		for p_name in params.shader_params:
			mat.set_shader_param(p_name, _coerce_property_value(params.shader_params[p_name]))

	if node.has_method("set_material"):
		node.set_material(mat)
	elif "material_override" in node:
		node.material_override = mat
	else:
		log_error("Node does not support materials: " + params.node_path)
		quit(1)
		return

	if save_scene_to_path(scene_root, params.scene_path):
		print("Shader material successfully applied to node " + params.node_path)
	else:
		log_error("Failed to save scene after applying shader material")
		quit(1)
		return

# Set custom metadata on a scene node (saves once)
func set_node_metadata(params):
	printerr("Setting node metadata in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	var meta_name = params.meta_name
	var meta_value = _coerce_property_value(params.meta_value)

	node.set_meta(meta_name, meta_value)

	if save_scene_to_path(scene_root, params.scene_path):
		print("Successfully set metadata '" + meta_name + "' on node " + params.node_path)
	else:
		log_error("Failed to save scene after setting metadata")
		quit(1)
		return

# Get custom metadata from a scene node
func get_node_metadata(params):
	printerr("Getting node metadata in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	var metadata = {}
	if params.has("meta_name") and params.meta_name != "":
		var meta_name = params.meta_name
		if node.has_meta(meta_name):
			metadata[meta_name] = node.get_meta(meta_name)
	else:
		for meta_name in node.get_meta_list():
			var val = node.get_meta(meta_name)
			if val is Vector2:
				metadata[meta_name] = {"x": val.x, "y": val.y}
			elif val is Vector3:
				metadata[meta_name] = {"x": val.x, "y": val.y, "z": val.z}
			elif val is Color:
				metadata[meta_name] = {"r": val.r, "g": val.g, "b": val.b, "a": val.a}
			elif typeof(val) in [TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_REAL, TYPE_STRING, TYPE_ARRAY, TYPE_DICTIONARY]:
				metadata[meta_name] = val
			else:
				metadata[meta_name] = str(val)

	print(to_json({"nodePath": params.node_path, "metadata": metadata}))

# Configure a Control/Container node's layout properties in one call (saves once)
func setup_control(params):
	printerr("Setting up Control node in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	if not (node is Control):
		log_error("Node is not a Control: " + params.node_path)
		quit(1)
		return

	var control: Control = node
	var applied: Array = []

	# Anchor preset
	if params.has("anchor_preset") and params.anchor_preset != "":
		var anchor_preset = params.anchor_preset
		var preset_map = {
			"top_left": Control.PRESET_TOP_LEFT,
			"top_right": Control.PRESET_TOP_RIGHT,
			"bottom_left": Control.PRESET_BOTTOM_LEFT,
			"bottom_right": Control.PRESET_BOTTOM_RIGHT,
			"center_left": Control.PRESET_CENTER_LEFT,
			"center_top": Control.PRESET_CENTER_TOP,
			"center_right": Control.PRESET_CENTER_RIGHT,
			"center_bottom": Control.PRESET_CENTER_BOTTOM,
			"center": Control.PRESET_CENTER,
			"left_wide": Control.PRESET_LEFT_WIDE,
			"top_wide": Control.PRESET_TOP_WIDE,
			"right_wide": Control.PRESET_RIGHT_WIDE,
			"bottom_wide": Control.PRESET_BOTTOM_WIDE,
			"vcenter_wide": Control.PRESET_VCENTER_WIDE,
			"hcenter_wide": Control.PRESET_HCENTER_WIDE,
			"full_rect": Control.PRESET_FULL_RECT,
		}
		if preset_map.has(anchor_preset):
			control.set_anchors_and_margins_preset(preset_map[anchor_preset], 0, 0)
			applied.append("anchor_preset=" + anchor_preset)

	# Min size (rect_min_size in Godot 3)
	if params.has("min_size") and params.min_size != "":
		var min_size_str = params.min_size
		var expr := Expression.new()
		if expr.parse(min_size_str) == OK:
			var val = expr.execute()
			if val is Vector2:
				control.rect_min_size = val
				applied.append("min_size=" + min_size_str)

	# Size flags horizontal
	if params.has("size_flags_h") and params.size_flags_h != "":
		var sf_h = params.size_flags_h
		var flags_map = {
			"fill": Control.SIZE_FILL,
			"expand": Control.SIZE_EXPAND,
			"fill_expand": Control.SIZE_EXPAND | Control.SIZE_FILL,
			"shrink_center": Control.SIZE_SHRINK_CENTER,
			"shrink_end": Control.SIZE_SHRINK_END,
		}
		if flags_map.has(sf_h):
			control.size_flags_horizontal = flags_map[sf_h]
			applied.append("size_flags_h=" + sf_h)

	# Size flags vertical
	if params.has("size_flags_v") and params.size_flags_v != "":
		var sf_v = params.size_flags_v
		var flags_map = {
			"fill": Control.SIZE_FILL,
			"expand": Control.SIZE_EXPAND,
			"fill_expand": Control.SIZE_EXPAND | Control.SIZE_FILL,
			"shrink_center": Control.SIZE_SHRINK_CENTER,
			"shrink_end": Control.SIZE_SHRINK_END,
		}
		if flags_map.has(sf_v):
			control.size_flags_vertical = flags_map[sf_v]
			applied.append("size_flags_v=" + sf_v)

	# Margins (for MarginContainer)
	if params.has("margins") and params.margins is Dictionary:
		var margins = params.margins
		if control is MarginContainer:
			if margins.has("left"):
				control.add_constant_override("margin_left", int(margins.left))
			if margins.has("top"):
				control.add_constant_override("margin_top", int(margins.top))
			if margins.has("right"):
				control.add_constant_override("margin_right", int(margins.right))
			if margins.has("bottom"):
				control.add_constant_override("margin_bottom", int(margins.bottom))
			applied.append("margins=" + str(margins))

	# Separation (for BoxContainer)
	if params.has("separation"):
		var sep = int(params.separation)
		if control is BoxContainer:
			control.add_constant_override("separation", sep)
			applied.append("separation=" + str(sep))

	# Grow direction horizontal
	if params.has("grow_h") and params.grow_h != "":
		var grow_h = params.grow_h
		var grow_map = {
			"begin": Control.GROW_DIRECTION_BEGIN,
			"end": Control.GROW_DIRECTION_END,
			"both": Control.GROW_DIRECTION_BOTH,
		}
		if grow_map.has(grow_h):
			control.grow_horizontal = grow_map[grow_h]
			applied.append("grow_h=" + grow_h)

	# Grow direction vertical
	if params.has("grow_v") and params.grow_v != "":
		var grow_v = params.grow_v
		var grow_map = {
			"begin": Control.GROW_DIRECTION_BEGIN,
			"end": Control.GROW_DIRECTION_END,
			"both": Control.GROW_DIRECTION_BOTH,
		}
		if grow_map.has(grow_v):
			control.grow_vertical = grow_map[grow_v]
			applied.append("grow_v=" + grow_v)

	if save_scene_to_path(scene_root, params.scene_path):
		print(to_json({"nodePath": params.node_path, "applied": applied, "count": applied.size()}))
	else:
		log_error("Failed to save scene after setup_control")
		quit(1)
		return



# Headlessly creates/overrides collision shapes on PhysicsBody or Area nodes in a single call.
func setup_collision(params):
	printerr("Setting up Collision in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	var dim = ""
	if node is Node2D or node is Control:
		dim = "2d"
	elif node is Spatial:
		dim = "3d"
	else:
		var parent = node.get_parent()
		while parent != null:
			if parent is Node2D or parent is Control:
				dim = "2d"
				break
			if parent is Spatial:
				dim = "3d"
				break
			parent = parent.get_parent()

	if dim == "":
		dim = params.get("dimension", "2d")

	var is_valid_parent = false
	if dim == "2d":
		if node is PhysicsBody2D or node is Area2D:
			is_valid_parent = true
	else:
		if node is PhysicsBody or node is Area:
			is_valid_parent = true

	if not is_valid_parent:
		log_error("Node '" + params.node_path + "' is not a physics body or area.")
		quit(1)
		return

	var shape = null
	var collision_node = null
	var shape_name = params.shape

	if dim == "2d":
		match shape_name:
			"rectangle", "rect":
				shape = RectangleShape2D.new()
				var w = float(params.get("width", 32.0))
				var h = float(params.get("height", 32.0))
				shape.extents = Vector2(w / 2.0, h / 2.0)
			"circle":
				shape = CircleShape2D.new()
				shape.radius = float(params.get("radius", 16.0))
			"capsule":
				shape = CapsuleShape2D.new()
				shape.radius = float(params.get("radius", 16.0))
				shape.height = float(params.get("height", 40.0))
			"segment":
				shape = SegmentShape2D.new()
				shape.a = Vector2(float(params.get("ax", 0.0)), float(params.get("ay", 0.0)))
				shape.b = Vector2(float(params.get("bx", 32.0)), float(params.get("by", 0.0)))
			"custom", "convex":
				shape = ConvexPolygonShape2D.new()
				var points_data = params.get("points", [])
				var pool = PoolVector2Array()
				for p in points_data:
					if p is Array and p.size() >= 2:
						pool.append(Vector2(float(p[0]), float(p[1])))
				if pool.size() >= 3:
					shape.points = pool
			_:
				log_error("Unknown 2D shape: " + shape_name)
				quit(1)
				return

		for child in node.get_children():
			if child is CollisionShape2D:
				collision_node = child
				break

		if not collision_node:
			collision_node = CollisionShape2D.new()
			node.add_child(collision_node)
			collision_node.owner = scene_root
			collision_node.name = "CollisionShape2D"

		collision_node.shape = shape
		if params.has("disabled"):
			collision_node.disabled = bool(params.disabled)
		if params.has("one_way_collision"):
			collision_node.one_way_collision = bool(params.one_way_collision)

	else:
		match shape_name:
			"box", "rectangle", "rect":
				shape = BoxShape.new()
				var sx = float(params.get("width", 1.0))
				var sy = float(params.get("height", 1.0))
				var sz = float(params.get("depth", 1.0))
				shape.extents = Vector3(sx / 2.0, sy / 2.0, sz / 2.0)
			"sphere", "circle":
				shape = SphereShape.new()
				shape.radius = float(params.get("radius", 0.5))
			"capsule":
				shape = CapsuleShape.new()
				shape.radius = float(params.get("radius", 0.5))
				shape.height = float(params.get("height", 2.0))
			"cylinder":
				shape = CylinderShape.new()
				shape.radius = float(params.get("radius", 0.5))
				shape.height = float(params.get("height", 2.0))
			"convex", "custom":
				shape = ConvexPolygonShape.new()
				var points_data = params.get("points", [])
				var pool = PoolVector3Array()
				for p in points_data:
					if p is Array and p.size() >= 3:
						pool.append(Vector3(float(p[0]), float(p[1]), float(p[2])))
				if pool.size() >= 4:
					shape.points = pool
			_:
				log_error("Unknown 3D shape: " + shape_name)
				quit(1)
				return

		for child in node.get_children():
			if child is CollisionShape:
				collision_node = child
				break

		if not collision_node:
			collision_node = CollisionShape.new()
			node.add_child(collision_node)
			collision_node.owner = scene_root
			collision_node.name = "CollisionShape"

		collision_node.shape = shape
		if params.has("disabled"):
			collision_node.disabled = bool(params.disabled)

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": params.node_path + "/" + collision_node.name,
			"shapeType": shape.get_class(),
			"dimension": dim.to_upper(),
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after setup_collision")
		quit(1)
		return


# Headlessly creates a MeshInstance primitive or imports a 3D asset scene.
func add_mesh_instance(params):
	printerr("Adding MeshInstance in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	if not (parent is Spatial):
		log_error("Parent node is not a Spatial: " + parent_path)
		quit(1)
		return

	var mesh_instance = MeshInstance.new()
	var node_name = params.get("name", "MeshInstance")
	mesh_instance.name = node_name

	var mesh_file = params.get("mesh_file", "")
	var mesh_type = params.get("mesh_type", "")

	if mesh_file != "":
		if not ResourceLoader.exists(mesh_file):
			log_error("Mesh file does not exist: " + mesh_file)
			mesh_instance.free()
			quit(1)
			return

		var loaded = load(mesh_file)
		if not loaded:
			log_error("Failed to load mesh file: " + mesh_file)
			mesh_instance.free()
			quit(1)
			return

		if loaded is Mesh:
			mesh_instance.mesh = loaded
		elif loaded is PackedScene:
			var temp_instance = loaded.instance()
			var found_mesh = null
			var queue = [temp_instance]
			while queue.size() > 0:
				var current = queue.pop_front()
				if current is MeshInstance and current.mesh != null:
					found_mesh = current.mesh
					break
				for child in current.get_children():
					queue.push_back(child)
			
			temp_instance.free()
			if found_mesh == null:
				log_error("No Mesh found in PackedScene: " + mesh_file)
				mesh_instance.free()
				quit(1)
				return
			mesh_instance.mesh = found_mesh
		else:
			log_error("Loaded resource is not a Mesh or PackedScene: " + mesh_file)
			mesh_instance.free()
			quit(1)
			return

	elif mesh_type != "":
		var mesh_res = null
		match mesh_type:
			"CubeMesh", "BoxMesh":
				mesh_res = CubeMesh.new()
			"SphereMesh":
				mesh_res = SphereMesh.new()
			"CylinderMesh":
				mesh_res = CylinderMesh.new()
			"CapsuleMesh":
				mesh_res = CapsuleMesh.new()
			"PlaneMesh":
				mesh_res = PlaneMesh.new()
			"PrismMesh":
				mesh_res = PrismMesh.new()
			"QuadMesh":
				mesh_res = QuadMesh.new()
			_:
				log_error("Unknown primitive mesh type: " + mesh_type)
				mesh_instance.free()
				quit(1)
				return

		if params.has("mesh_properties") and params.mesh_properties is Dictionary:
			var props = params.mesh_properties
			for prop_name in props:
				if prop_name in mesh_res:
					mesh_res.set(prop_name, _coerce_property_value(props[prop_name]))

		mesh_instance.mesh = mesh_res
	else:
		log_error("Either mesh_file or mesh_type is required")
		mesh_instance.free()
		quit(1)
		return

	if params.has("position"):
		mesh_instance.translation = _coerce_property_value(params.position)
	if params.has("rotation"):
		mesh_instance.rotation_degrees = _coerce_property_value(params.rotation)
	if params.has("scale"):
		mesh_instance.scale = _coerce_property_value(params.scale)

	parent.add_child(mesh_instance)
	mesh_instance.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": parent_path + "/" + mesh_instance.name,
			"name": mesh_instance.name,
			"meshType": mesh_type if mesh_file == "" else mesh_file,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after add_mesh_instance")
		quit(1)
		return



# Helper to parse layer values in Godot 3 (supports int or Array of indices)
func _parse_layer_value(value):
	if value is int or value is float:
		return int(value)
	if value is Array:
		var mask = 0
		for item in value:
			var n = int(item)
			if n >= 1 and n <= 32:
				mask |= (1 << (n - 1))
		return mask
	return int(value)


# Modifies physics layers and masks (2D and 3D) inside the scene.
func set_physics_layers(params):
	printerr("Setting physics layers in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	if not ("collision_layer" in node):
		log_error("Node '" + params.node_path + "' does not have collision_layer property.")
		quit(1)
		return

	var applied = {}

	if params.has("collision_layer"):
		var val = _parse_layer_value(params.collision_layer)
		node.set("collision_layer", val)
		applied["collision_layer"] = val

	if params.has("collision_mask"):
		var val = _parse_layer_value(params.collision_mask)
		node.set("collision_mask", val)
		applied["collision_mask"] = val

	if applied.size() == 0:
		log_error("Must provide collision_layer and/or collision_mask")
		quit(1)
		return

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": params.node_path,
			"applied": applied,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after set_physics_layers")
		quit(1)
		return


# Reads the current physics layers and mask names and values.
func get_physics_layers(params):
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("Node not found: " + params.node_path)
		quit(1)
		return

	if not ("collision_layer" in node):
		log_error("Node '" + params.node_path + "' does not have collision_layer property.")
		quit(1)
		return

	var layer = int(node.get("collision_layer"))
	var mask = int(node.get("collision_mask"))

	var dim = "2d"
	if node is Spatial:
		dim = "3d"
	else:
		var parent = node.get_parent()
		while parent != null:
			if parent is Node2D or parent is Control:
				dim = "2d"
				break
			if parent is Spatial:
				dim = "3d"
				break
			parent = parent.get_parent()

	var layer_info = []
	var mask_info = []

	for i in range(1, 33):
		if (layer & (1 << (i - 1))) != 0:
			var layer_name = ""
			var key = "layer_names/" + dim + "_physics/layer_" + str(i)
			if ProjectSettings.has_setting(key):
				layer_name = str(ProjectSettings.get_setting(key))
			var entry = {"layer": i}
			if layer_name != "":
				entry["name"] = layer_name
			layer_info.append(entry)

		if (mask & (1 << (i - 1))) != 0:
			var layer_name = ""
			var key = "layer_names/" + dim + "_physics/layer_" + str(i)
			if ProjectSettings.has_setting(key):
				layer_name = str(ProjectSettings.get_setting(key))
			var entry = {"layer": i}
			if layer_name != "":
				entry["name"] = layer_name
			mask_info.append(entry)

	var response = {
		"nodePath": params.node_path,
		"collision_layer": layer,
		"collision_layer_info": layer_info,
		"collision_mask": mask,
		"collision_mask_info": mask_info,
		"success": true
	}
	print(to_json(response))


# Headlessly adds a RayCast or RayCast2D node under a parent.
func add_raycast(params):
	printerr("Adding RayCast in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	var dim = params.get("dimension", "")
	if dim == "":
		if parent is Node2D or parent is Control:
			dim = "2d"
		elif parent is Spatial:
			dim = "3d"
		else:
			dim = "2d"

	var ray_name = params.get("name", "RayCast")
	var enabled = bool(params.get("enabled", true))
	var collision_mask = int(params.get("collision_mask", 1))
	var collide_with_areas = bool(params.get("collide_with_areas", false))
	var collide_with_bodies = bool(params.get("collide_with_bodies", true))

	var ray = null
	if dim == "2d":
		ray = RayCast2D.new()
		ray.name = ray_name
		ray.enabled = enabled
		ray.collision_mask = collision_mask
		ray.collide_with_areas = collide_with_areas
		ray.collide_with_bodies = collide_with_bodies
		var tx = float(params.get("target_x", 0.0))
		var ty = float(params.get("target_y", 50.0))
		ray.cast_to = Vector2(tx, ty)
	else:
		ray = RayCast.new() # standard RayCast in Godot 3.x
		ray.name = ray_name
		ray.enabled = enabled
		ray.collision_mask = collision_mask
		ray.collide_with_areas = collide_with_areas
		ray.collide_with_bodies = collide_with_bodies
		var tx = float(params.get("target_x", 0.0))
		var ty = float(params.get("target_y", -1.0))
		var tz = float(params.get("target_z", 0.0))
		ray.cast_to = Vector3(tx, ty, tz)

	parent.add_child(ray)
	ray.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": parent_path + "/" + ray.name,
			"name": ray.name,
			"dimension": dim.to_upper(),
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after add_raycast")
		quit(1)
		return


# Configures or adds a Camera (3D) or Camera2D node in a scene.
func setup_camera(params):
	printerr("Setting up Camera in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	var dim = params.get("dimension", "")
	if dim == "":
		if parent is Node2D or parent is Control:
			dim = "2d"
		elif parent is Spatial:
			dim = "3d"
		else:
			dim = "2d"

	var node_name = params.get("name", "Camera" if dim == "3d" else "Camera2D")
	
	var camera = null
	for child in parent.get_children():
		if dim == "2d" and child is Camera2D and child.name == node_name:
			camera = child
			break
		elif dim == "3d" and child is Camera and child.name == node_name:
			camera = child
			break

	var is_new = false
	if not camera:
		is_new = true
		if dim == "2d":
			camera = Camera2D.new()
		else:
			camera = Camera.new()
		camera.name = node_name

	if params.has("current"):
		camera.current = bool(params.current)
	else:
		camera.current = true

	if dim == "2d":
		if params.has("zoom"):
			camera.zoom = _coerce_property_value(params.zoom)
		if params.has("position"):
			camera.position = _coerce_property_value(params.position)
		if params.has("offset"):
			camera.offset = _coerce_property_value(params.offset)
	else:
		if params.has("fov"):
			camera.fov = float(params.fov)
		if params.has("near"):
			camera.near = float(params.near)
		if params.has("far"):
			camera.far = float(params.far)
		if params.has("position"):
			camera.translation = _coerce_property_value(params.position)
		if params.has("rotation"):
			camera.rotation_degrees = _coerce_property_value(params.rotation)
		if params.has("look_at"):
			var eye = camera.translation
			var target = _coerce_property_value(params.look_at)
			if eye is Vector3 and target is Vector3:
				var up = Vector3.UP
				var z_dir = (eye - target).normalized()
				if z_dir.length_squared() > 0.001:
					if abs(z_dir.dot(up)) > 0.999:
						up = Vector3.FORWARD
					var x_dir = up.cross(z_dir).normalized()
					var y_dir = z_dir.cross(x_dir).normalized()
					var basis = Basis(x_dir, y_dir, z_dir)
					camera.rotation_degrees = basis.get_euler() * (180.0 / PI)

	if is_new:
		parent.add_child(camera)
		camera.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": parent_path + "/" + camera.name,
			"name": camera.name,
			"dimension": dim.to_upper(),
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after setup_camera")
		quit(1)
		return


# Adds or configures a Spatial Light node (DirectionalLight, OmniLight, SpotLight).
func setup_lighting(params):
	printerr("Setting up Lighting in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	if not (parent is Spatial):
		log_error("Parent node is not a Spatial (3D): " + parent_path)
		quit(1)
		return

	var light_type = params.get("light_type", "DirectionalLight")
	var preset = params.get("preset", "")
	var node_name = params.get("name", "")

	if preset != "":
		match preset:
			"sun":
				light_type = "DirectionalLight"
				if node_name == "":
					node_name = "SunLight"
			"indoor":
				light_type = "OmniLight"
				if node_name == "":
					node_name = "IndoorLight"
			"dramatic":
				light_type = "SpotLight"
				if node_name == "":
					node_name = "DramaticLight"
			_:
				log_error("Unknown preset: " + preset)
				quit(1)
				return

	if node_name == "":
		node_name = light_type

	var light = null
	match light_type:
		"DirectionalLight":
			light = DirectionalLight.new()
		"OmniLight":
			light = OmniLight.new()
		"SpotLight":
			light = SpotLight.new()
		_:
			log_error("Unknown light type: " + light_type)
			quit(1)
			return

	light.name = node_name

	if params.has("color"):
		light.light_color = _coerce_property_value(params.color)
	if params.has("energy"):
		light.light_energy = float(params.energy)
	if params.has("shadows"):
		light.shadow_enabled = bool(params.shadows)

	if light is OmniLight:
		if params.has("range"):
			light.omni_range = float(params.range)
		if params.has("attenuation"):
			light.omni_attenuation = float(params.attenuation)
	elif light is SpotLight:
		if params.has("range"):
			light.spot_range = float(params.range)
		if params.has("attenuation"):
			light.spot_attenuation = float(params.attenuation)
		if params.has("spot_angle"):
			light.spot_angle = float(params.spot_angle)
		if params.has("spot_angle_attenuation"):
			light.spot_angle_attenuation = float(params.spot_angle_attenuation)

	if preset != "":
		match preset:
			"sun":
				light.light_energy = float(params.get("energy", 1.0))
				light.shadow_enabled = bool(params.get("shadows", true))
				light.rotation_degrees = Vector3(-45, -30, 0)
			"indoor":
				light.light_energy = float(params.get("energy", 0.8))
				light.light_color = Color(1.0, 0.95, 0.85)
				if light is OmniLight:
					light.omni_range = float(params.get("range", 8.0))
			"dramatic":
				light.light_energy = float(params.get("energy", 2.0))
				light.shadow_enabled = bool(params.get("shadows", true))
				if light is SpotLight:
					light.spot_angle = float(params.get("spot_angle", 25.0))
					light.spot_range = float(params.get("range", 10.0))

	if params.has("position"):
		light.translation = _coerce_property_value(params.position)
	if params.has("rotation"):
		light.rotation_degrees = _coerce_property_value(params.rotation)

	parent.add_child(light)
	light.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": parent_path + "/" + light.name,
			"name": light.name,
			"lightType": light_type,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after setup_lighting")
		quit(1)
		return


# Adds or configures a WorldEnvironment node.
func setup_environment(params):
	printerr("Setting up Environment in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	var node_name = params.get("name", "WorldEnvironment")
	
	var world_env = null
	for child in parent.get_children():
		if child is WorldEnvironment and child.name == node_name:
			world_env = child
			break

	var is_new = false
	if not world_env:
		is_new = true
		world_env = WorldEnvironment.new()
		world_env.name = node_name

	var env = world_env.environment
	if not env:
		env = Environment.new()
		world_env.environment = env

	var bg_mode = params.get("ambient_mode", "Color")
	match bg_mode.to_lower():
		"color":
			env.background_mode = Environment.BG_COLOR
			if params.has("ambient_color"):
				env.background_color = _coerce_property_value(params.ambient_color)
		"sky":
			env.background_mode = Environment.BG_SKY
		"canvas":
			env.background_mode = Environment.BG_CANVAS
		"clear_color":
			env.background_mode = Environment.BG_CLEAR_COLOR

	var sky_type = params.get("sky_type", "none")
	if sky_type == "ProceduralSky":
		var sky = ProceduralSky.new()
		if params.has("sky_top_color"):
			sky.sky_top_color = _coerce_property_value(params.sky_top_color)
		if params.has("sky_horizon_color"):
			sky.sky_horizon_color = _coerce_property_value(params.sky_horizon_color)
		if params.has("ground_bottom_color"):
			sky.ground_bottom_color = _coerce_property_value(params.ground_bottom_color)
		if params.has("ground_horizon_color"):
			sky.ground_horizon_color = _coerce_property_value(params.ground_horizon_color)
		env.sky = sky
		env.background_mode = Environment.BG_SKY

	if params.has("ambient_color"):
		env.ambient_light_color = _coerce_property_value(params.ambient_color)
	if params.has("ambient_energy"):
		env.ambient_light_energy = float(params.ambient_energy)

	if params.has("glow_enabled"):
		env.glow_enabled = bool(params.glow_enabled)
	if params.has("ssao_enabled"):
		env.ssao_enabled = bool(params.ssao_enabled)
	if params.has("ssr_enabled"):
		env.ssr_enabled = bool(params.ssr_enabled)
	if params.has("fog_enabled"):
		env.fog_enabled = bool(params.fog_enabled)

	if is_new:
		parent.add_child(world_env)
		world_env.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": parent_path + "/" + world_env.name,
			"name": world_env.name,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after setup_environment")
		quit(1)
		return


# Configures a Navigation node and bakes NavigationMesh (synchronous) in 3D.
func setup_navigation_3d(params):
	printerr("Setting up Navigation in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	var nav_node_name = params.get("navigation_name", "Navigation")
	var nav_node = null
	for child in parent.get_children():
		if child is Navigation and child.name == nav_node_name:
			nav_node = child
			break

	var is_nav_new = false
	if not nav_node:
		is_nav_new = true
		nav_node = Navigation.new()
		nav_node.name = nav_node_name
		parent.add_child(nav_node)
		nav_node.owner = scene_root

	var navmesh_instance_name = params.get("name", "NavigationMeshInstance")
	var navmesh_instance = null
	for child in nav_node.get_children():
		if child is NavigationMeshInstance and child.name == navmesh_instance_name:
			navmesh_instance = child
			break

	var is_instance_new = false
	if not navmesh_instance:
		is_instance_new = true
		navmesh_instance = NavigationMeshInstance.new()
		navmesh_instance.name = navmesh_instance_name
		nav_node.add_child(navmesh_instance)
		navmesh_instance.owner = scene_root

	var navmesh = navmesh_instance.navmesh
	if not navmesh:
		navmesh = NavigationMesh.new()
		navmesh_instance.navmesh = navmesh

	if params.has("cell_size"):
		navmesh.cell_size = float(params.cell_size)
	if params.has("cell_height"):
		navmesh.cell_height = float(params.cell_height)
	if params.has("agent_height"):
		navmesh.agent_height = float(params.agent_height)
	if params.has("agent_radius"):
		navmesh.agent_radius = float(params.agent_radius)
	if params.has("agent_max_climb"):
		navmesh.agent_max_climb = float(params.agent_max_climb)
	if params.has("agent_max_slope"):
		navmesh.agent_max_slope = float(params.agent_max_slope)

	navmesh_instance.bake_navigation_mesh(false)

	var agent_created = false
	var agent_node_path = ""
	if params.get("setup_agent", false):
		if ClassDB.class_exists("NavigationAgent"):
			var agent_parent_path = params.get("agent_parent_path", "")
			if agent_parent_path != "":
				var agent_parent = find_node_by_path(scene_root, agent_parent_path)
				if agent_parent:
					var agent_name = params.get("agent_name", "NavigationAgent")
					var agent = null
					for child in agent_parent.get_children():
						if child.get_class() == "NavigationAgent" and child.name == agent_name:
							agent = child
							break
					if not agent:
						agent = ClassDB.instance("NavigationAgent")
						agent.name = agent_name
						agent_parent.add_child(agent)
						agent.owner = scene_root
						agent_created = true
						agent_node_path = agent_parent_path + "/" + agent_name
					
					if params.has("agent_radius"):
						agent.set("radius", float(params.agent_radius))
					if params.has("agent_height"):
						agent.set("height", float(params.agent_height))
		else:
			log_info("NavigationAgent class not available in this Godot build, skipping agent setup.")

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"navigationPath": parent_path + "/" + nav_node.name,
			"instancePath": parent_path + "/" + nav_node.name + "/" + navmesh_instance.name,
			"agentPath": agent_node_path,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after setup_navigation_3d")
		quit(1)
		return


# Creates and configures CPUParticles (GLES2/3 compatible) with sparks/fire/smoke presets.
func create_particles_3d(params):
	printerr("Creating CPUParticles in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	if not (parent is Spatial):
		log_error("Parent node is not a Spatial (3D): " + parent_path)
		quit(1)
		return

	var particles = CPUParticles.new()
	particles.name = params.get("name", "CPUParticles")

	var quad_mesh = QuadMesh.new()
	quad_mesh.size = Vector2(0.5, 0.5)
	particles.mesh = quad_mesh

	var material = SpatialMaterial.new()
	material.flags_unshaded = true
	material.vertex_color_use_as_albedo = true
	material.params_billboard_mode = SpatialMaterial.BILLBOARD_PARTICLES
	material.params_blend_mode = SpatialMaterial.BLEND_MODE_ADD
	quad_mesh.material = material

	var preset = params.get("preset", "fire")
	match preset.to_lower():
		"fire":
			particles.amount = int(params.get("amount", 40))
			particles.lifetime = float(params.get("lifetime", 1.0))
			particles.speed_scale = 1.2
			particles.direction = Vector3(0, 1, 0)
			particles.spread = 15.0
			particles.gravity = Vector3(0, 2, 0)
			particles.initial_velocity = 2.0
			particles.linear_accel = 1.0
			particles.damping = 0.5
			var size_curve = Curve.new()
			size_curve.add_point(Vector2(0, 0.2))
			size_curve.add_point(Vector2(0.3, 1.0))
			size_curve.add_point(Vector2(1, 0.0))
			particles.scale_amount_curve = size_curve
			var gradient = Gradient.new()
			gradient.set_color(0, Color(1.0, 0.9, 0.0, 1.0))
			gradient.set_color(1, Color(0.8, 0.0, 0.0, 0.0))
			particles.color_ramp = gradient
			material.params_blend_mode = SpatialMaterial.BLEND_MODE_ADD
		"smoke":
			particles.amount = int(params.get("amount", 25))
			particles.lifetime = float(params.get("lifetime", 2.0))
			particles.speed_scale = 0.8
			particles.direction = Vector3(0, 1, 0)
			particles.spread = 25.0
			particles.gravity = Vector3(0, 0.5, 0)
			particles.initial_velocity = 1.0
			particles.linear_accel = 0.2
			var size_curve = Curve.new()
			size_curve.add_point(Vector2(0, 0.4))
			size_curve.add_point(Vector2(1, 2.0))
			particles.scale_amount_curve = size_curve
			var gradient = Gradient.new()
			gradient.set_color(0, Color(0.3, 0.3, 0.3, 0.6))
			gradient.set_color(1, Color(0.1, 0.1, 0.1, 0.0))
			particles.color_ramp = gradient
			material.params_blend_mode = SpatialMaterial.BLEND_MODE_MIX
		"sparks":
			particles.amount = int(params.get("amount", 50))
			particles.lifetime = float(params.get("lifetime", 0.8))
			particles.speed_scale = 1.5
			particles.explosiveness = 0.8
			particles.direction = Vector3(0, 1, 0)
			particles.spread = 60.0
			particles.gravity = Vector3(0, -9.8, 0)
			particles.initial_velocity = 5.0
			particles.damping = 1.0
			var size_curve = Curve.new()
			size_curve.add_point(Vector2(0, 1.0))
			size_curve.add_point(Vector2(1, 0.0))
			particles.scale_amount_curve = size_curve
			var gradient = Gradient.new()
			gradient.set_color(0, Color(1.0, 1.0, 0.5, 1.0))
			gradient.set_color(1, Color(1.0, 0.5, 0.0, 0.0))
			particles.color_ramp = gradient
			material.params_blend_mode = SpatialMaterial.BLEND_MODE_ADD

	if params.has("amount"):
		particles.amount = int(params.get("amount"))
	if params.has("lifetime"):
		particles.lifetime = float(params.get("lifetime"))
	if params.has("explosiveness"):
		particles.explosiveness = float(params.get("explosiveness"))
	if params.has("direction"):
		particles.direction = _coerce_property_value(params.direction)
	if params.has("spread"):
		particles.spread = float(params.spread)
	if params.has("gravity"):
		particles.gravity = _coerce_property_value(params.gravity)
	if params.has("initial_velocity"):
		particles.initial_velocity = float(params.initial_velocity)
	if params.has("position"):
		particles.translation = _coerce_property_value(params.position)

	parent.add_child(particles)
	particles.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": parent_path + "/" + particles.name,
			"name": particles.name,
			"preset": preset,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after create_particles_3d")
		quit(1)
		return


# Sets up or modifies an AnimationTree node with an AnimationNodeStateMachine.
func setup_animation_tree(params):
	printerr("Setting up AnimationTree in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	var tree_name = params.get("name", "AnimationTree")
	var anim_tree = null
	for child in parent.get_children():
		if child is AnimationTree and child.name == tree_name:
			anim_tree = child
			break

	var is_new = false
	if not anim_tree:
		is_new = true
		anim_tree = AnimationTree.new()
		anim_tree.name = tree_name

	if params.has("anim_player_path"):
		anim_tree.anim_player = _coerce_property_value(params.anim_player_path)

	var state_machine = anim_tree.tree_root
	if not (state_machine is AnimationNodeStateMachine):
		state_machine = AnimationNodeStateMachine.new()
		anim_tree.tree_root = state_machine

	if params.has("states"):
		var states_list = params.states
		if states_list is Array:
			for state_name in states_list:
				if not state_machine.has_node(state_name):
					var node_anim = AnimationNodeAnimation.new()
					node_anim.animation = state_name
					state_machine.add_node(state_name, node_anim)

	if params.has("transitions"):
		var trans_list = params.transitions
		if trans_list is Array:
			for trans in trans_list:
				if trans is Dictionary and trans.has("from") and trans.has("to"):
					var from_state = trans.from
					var to_state = trans.to
					if state_machine.has_node(from_state) and state_machine.has_node(to_state):
						if not state_machine.has_transition(from_state, to_state):
							var transition = AnimationNodeStateMachineTransition.new()
							if trans.get("auto_advance", false):
								transition.auto_advance = true
							state_machine.add_transition(from_state, to_state, transition)

	if params.get("active", true):
		anim_tree.active = true

	if is_new:
		parent.add_child(anim_tree)
		anim_tree.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": parent_path + "/" + anim_tree.name,
			"name": anim_tree.name,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after setup_animation_tree")
		quit(1)
		return


# Automatically generates collision shapes based on MeshInstance geometry.
func setup_collision_3d(params):
	printerr("Setting up Collision 3D in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var node = find_node_by_path(scene_root, params.node_path)
	if not node:
		log_error("MeshInstance node not found: " + params.node_path)
		quit(1)
		return

	if not (node is MeshInstance):
		log_error("Target node is not a MeshInstance: " + params.node_path)
		quit(1)
		return

	var mesh = node.mesh
	if not mesh:
		log_error("Target MeshInstance has no mesh resource assigned")
		quit(1)
		return

	var collision_type = params.get("collision_type", "box")
	var shape = null
	var shape_offset = Vector3.ZERO

	if collision_type.to_lower() == "box":
		shape = BoxShape.new()
		var aabb = mesh.get_aabb()
		shape.extents = aabb.size / 2.0
		shape_offset = aabb.position + aabb.size / 2.0
	elif collision_type.to_lower() == "convex":
		shape = mesh.create_convex_shape()
	elif collision_type.to_lower() == "sphere" and mesh is SphereMesh:
		shape = SphereShape.new()
		shape.radius = mesh.radius
	elif collision_type.to_lower() == "cylinder" and mesh is CylinderMesh:
		shape = CylinderShape.new()
		shape.radius = mesh.top_radius
		shape.height = mesh.height
	else:
		# Fallback to general bounding box
		shape = BoxShape.new()
		var aabb = mesh.get_aabb()
		shape.extents = aabb.size / 2.0
		shape_offset = aabb.position + aabb.size / 2.0

	var parent = node.get_parent()
	var collision_node = null

	# If the mesh's parent is already a collision object, add shape as sibling.
	# Otherwise, create the shape directly under the MeshInstance.
	var target_parent = node
	if parent is CollisionObject:
		target_parent = parent

	var collision_name = node.name + "Collision"
	for child in target_parent.get_children():
		if child is CollisionShape and child.name == collision_name:
			collision_node = child
			break

	var is_new = false
	if not collision_node:
		is_new = true
		collision_node = CollisionShape.new()
		collision_node.name = collision_name

	collision_node.shape = shape
	collision_node.translation = shape_offset

	if is_new:
		target_parent.add_child(collision_node)
		collision_node.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": str(collision_node.get_path()).replace("/root/", "root/"),
			"shapeType": shape.get_class(),
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after setup_collision_3d")
		quit(1)
		return


# Instantiates and configures physical joints between physics bodies.
func setup_joint_3d(params):
	printerr("Setting up Physical Joint 3D in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	var joint_type = params.get("joint_type", "PinJoint")
	var joint = null
	match joint_type:
		"PinJoint":
			joint = PinJoint.new()
		"HingeJoint":
			joint = HingeJoint.new()
		"SliderJoint":
			joint = SliderJoint.new()
		"ConeTwistJoint":
			joint = ConeTwistJoint.new()
		"Generic6DOFJoint":
			joint = Generic6DOFJoint.new()
		_:
			log_error("Unknown physical joint type: " + joint_type)
			quit(1)
			return

	joint.name = params.get("name", joint_type)

	if params.has("node_a"):
		joint.set("nodes/node_a", _coerce_property_value(params.node_a))
	if params.has("node_b"):
		joint.set("nodes/node_b", _coerce_property_value(params.node_b))

	if params.has("position"):
		joint.translation = _coerce_property_value(params.position)
	if params.has("rotation"):
		joint.rotation_degrees = _coerce_property_value(params.rotation)

	parent.add_child(joint)
	joint.owner = scene_root

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"nodePath": parent_path + "/" + joint.name,
			"name": joint.name,
			"jointType": joint_type,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after setup_joint_3d")
		quit(1)
		return

func _resolve_anchor_preset(preset) -> int:
	if typeof(preset) == TYPE_INT or typeof(preset) == TYPE_REAL:
		return int(preset)
	if typeof(preset) == TYPE_STRING:
		match preset.to_lower():
			"top_left": return Control.PRESET_TOP_LEFT
			"top_right": return Control.PRESET_TOP_RIGHT
			"bottom_left": return Control.PRESET_BOTTOM_LEFT
			"bottom_right": return Control.PRESET_BOTTOM_RIGHT
			"center_left": return Control.PRESET_CENTER_LEFT
			"center_top": return Control.PRESET_CENTER_TOP
			"center_right": return Control.PRESET_CENTER_RIGHT
			"center_bottom": return Control.PRESET_CENTER_BOTTOM
			"center": return Control.PRESET_CENTER
			"left_wide": return Control.PRESET_LEFT_WIDE
			"top_wide": return Control.PRESET_TOP_WIDE
			"right_wide": return Control.PRESET_RIGHT_WIDE
			"bottom_wide": return Control.PRESET_BOTTOM_WIDE
			"vcenter_wide": return Control.PRESET_VCENTER_WIDE
			"hcenter_wide": return Control.PRESET_HCENTER_WIDE
			"wide", "full_rect": return Control.PRESET_WIDE
	return Control.PRESET_TOP_LEFT

func _instantiate_gui_node(scene_root: Node, parent_node: Node, node_spec: Dictionary) -> Node:
	var node_type = node_spec.get("type", "Control")
	var node = instantiate_class(node_type)
	if not node:
		printerr("Failed to instantiate GUI node type: " + node_type)
		return null

	node.name = node_spec.get("name", node_type)
	parent_node.add_child(node)
	node.owner = scene_root

	if node is Control:
		if node_spec.has("anchor_preset"):
			var preset_idx = _resolve_anchor_preset(node_spec.anchor_preset)
			node.set_anchors_and_margins_preset(preset_idx, 0, 0)

		if node_spec.has("margins") and node_spec.margins is Dictionary:
			var margins = node_spec.margins
			if margins.has("left"): node.margin_left = float(margins.left)
			if margins.has("top"): node.margin_top = float(margins.top)
			if margins.has("right"): node.margin_right = float(margins.right)
			if margins.has("bottom"): node.margin_bottom = float(margins.bottom)

		if node_spec.has("min_size") and node_spec.min_size is Dictionary:
			var ms = node_spec.min_size
			node.rect_min_size = Vector2(float(ms.get("x", 0.0)), float(ms.get("y", 0.0)))

	if node_spec.has("properties") and node_spec.properties is Dictionary:
		for prop in node_spec.properties:
			node.set(prop, _coerce_property_value(node_spec.properties[prop]))

	if node_spec.has("children") and node_spec.children is Array:
		for child_spec in node_spec.children:
			if child_spec is Dictionary:
				_instantiate_gui_node(scene_root, node, child_spec)

	return node

func pipe_animation_states(params):
	printerr("Piping animation states in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var tree_path = params.get("tree_path", "AnimationTree")
	var anim_tree = find_node_by_path(scene_root, tree_path)
	if not anim_tree:
		log_error("AnimationTree node not found at path: " + tree_path)
		quit(1)
		return

	if not (anim_tree is AnimationTree):
		log_error("Node at " + tree_path + " is not an AnimationTree")
		quit(1)
		return

	var state_machine = anim_tree.tree_root
	if not (state_machine is AnimationNodeStateMachine):
		state_machine = AnimationNodeStateMachine.new()
		anim_tree.tree_root = state_machine

	var states_added = []
	if params.has("states") and params.states is Array:
		for state in params.states:
			if state is Dictionary and state.has("name") and state.has("anim_name"):
				var name = state.name
				var anim_name = state.anim_name
				if state_machine.has_node(name):
					state_machine.remove_node(name)
				var node_anim = AnimationNodeAnimation.new()
				node_anim.animation = anim_name
				state_machine.add_node(name, node_anim)
				states_added.append({"name": name, "anim_name": anim_name})

	var transitions_linked = []
	if params.has("transitions") and params.transitions is Array:
		for trans in params.transitions:
			if trans is Dictionary and trans.has("from") and trans.has("to"):
				var from_state = trans.from
				var to_state = trans.to
				if state_machine.has_node(from_state) and state_machine.has_node(to_state):
					var idx = state_machine.find_transition(from_state, to_state)
					var transition = null
					if idx != -1:
						transition = state_machine.get_transition(idx)
					else:
						transition = AnimationNodeStateMachineTransition.new()
						state_machine.add_transition(from_state, to_state, transition)
					
					if trans.has("xfade_time"):
						transition.xfade_time = float(trans.xfade_time)
					if trans.has("auto_advance"):
						transition.auto_advance = bool(trans.auto_advance)
					
					transitions_linked.append({
						"from": from_state,
						"to": to_state,
						"xfade_time": transition.xfade_time,
						"auto_advance": transition.auto_advance
					})

	if params.get("active", true):
		anim_tree.active = true

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"treePath": tree_path,
			"states_added": states_added,
			"transitions_linked": transitions_linked,
			"active": anim_tree.active,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after pipe_animation_states")
		quit(1)
		return

func generate_gui_hierarchy(params):
	printerr("Generating GUI hierarchy in scene: " + params.scene_path)
	var scene_root = load_scene_instance(params.scene_path)
	if not scene_root:
		quit(1)
		return

	var parent_path = "root"
	if params.has("parent_path") and params.parent_path != "":
		parent_path = params.parent_path

	var parent = find_node_by_path(scene_root, parent_path)
	if not parent:
		log_error("Parent node not found: " + parent_path)
		quit(1)
		return

	var hierarchy = params.get("hierarchy")
	if not hierarchy or not (hierarchy is Dictionary):
		log_error("Hierarchy parameter must be a recursive layout dictionary")
		quit(1)
		return

	var created_node = _instantiate_gui_node(scene_root, parent, hierarchy)
	if not created_node:
		log_error("Failed to instantiate GUI node tree hierarchy")
		quit(1)
		return

	if save_scene_to_path(scene_root, params.scene_path):
		var response = {
			"scene_path": params.scene_path,
			"parent_path": parent_path,
			"root_node_name": created_node.name,
			"root_node_path": parent_path + "/" + created_node.name,
			"success": true
		}
		print(to_json(response))
	else:
		log_error("Failed to save scene after generate_gui_hierarchy")
		quit(1)
		return

