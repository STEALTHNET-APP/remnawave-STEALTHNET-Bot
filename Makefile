

.PHONY: menu checkout update watch rebuild docker frontend logs start stop restart \
        ps status clean alias switch branch

DOCKER_COMPOSE := docker compose
FRONT_SCRIPT := ./scripts/update-front-with-external-nginx.sh

SCRIPT_VERSION := v1.4.3
PANEL_TAG := $(shell git describe --tags --exact-match 2>/dev/null)
PANEL_VERSION := $(shell awk -F'"' '/"version"[[:space:]]*:/ {print $$4; exit}' version.json 2>/dev/null)
PANEL_VERSION_DISPLAY := $(if $(PANEL_TAG),$(PANEL_TAG),$(if $(PANEL_VERSION),v$(PANEL_VERSION),unknown))

MENU_TARGETS := checkout update rebuild watch docker frontend logs start stop restart ps status clean alias

.DEFAULT_GOAL := menu

menu: ## 🧭 Interactive command menu
	@bash -c '\
		trap "printf \"\\n\"; exit 0" INT; \
		while :; do \
		targets="$(MENU_TARGETS)"; \
		printf "\n\033[1;36m"; \
		printf " ███████╗████████╗███████╗ █████╗ ██╗  ████████╗██╗  ██╗███╗   ██╗███████╗████████╗\n"; \
		printf " ██╔════╝╚══██╔══╝██╔════╝██╔══██╗██║  ╚══██╔══╝██║  ██║████╗  ██║██╔════╝╚══██╔══╝\n"; \
		printf " ███████╗   ██║   █████╗  ███████║██║     ██║   ███████║██╔██╗ ██║█████╗     ██║\n"; \
		printf " ╚════██║   ██║   ██╔══╝  ██╔══██║██║     ██║   ██╔══██║██║╚██╗██║██╔══╝     ██║\n"; \
		printf " ███████║   ██║   ███████╗██║  ██║███████╗██║   ██║  ██║██║ ╚████║███████╗   ██║\n"; \
		printf " ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝\n"; \
		printf "\033[0m\n"; \
		branch=$$(git branch --show-current 2>/dev/null); \
		[ -n "$$branch" ] || branch=$$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || printf "unknown"); \
		printf "\033[1mSelect command:\033[0m    \033[2mScript $(SCRIPT_VERSION) • STEALTHNET $(PANEL_VERSION_DISPLAY)\033[0m \033[36m[\033[0m\033[1;36m%s\033[0m\033[36m]\033[0m\n\n" "$$branch"; \
		i=1; \
		for target in $$targets; do \
			desc=$$(awk -v target="$$target" '\''BEGIN {FS=":.*##"} $$1 == target {gsub(/^[ \t]+/, "", $$2); print $$2; exit}'\'' $(MAKEFILE_LIST)); \
			printf "  \033[36m%2d)\033[0m %-12s %s\n" "$$i" "$$target" "$$desc"; \
			i=$$((i + 1)); \
		done; \
		printf "\nCommand number (q to quit): "; \
		read -r choice; \
		case "$$choice" in q|Q) exit 0 ;; esac; \
		case "$$choice" in *[!0-9]*|"") printf "Invalid choice\n"; continue ;; esac; \
		set -- $$targets; \
		if [ "$$choice" -lt 1 ] || [ "$$choice" -gt "$$#" ]; then \
			printf "Invalid choice\n"; \
			continue; \
		fi; \
		idx=$$choice; \
		eval selected="\$${$$idx}"; \
		trap "" INT; \
		bash -c '\''trap - INT; exec "$$@"'\'' sh $(MAKE) --no-print-directory "$$selected"; \
		code=$$?; \
		trap - INT; \
		[ "$$code" -eq 130 ] && exit 0; \
		done; \
	'

##
## Development
##

rebuild: docker frontend ## 🔄 Rebuild containers and frontend

watch: rebuild ## 👀 Rebuild project and follow logs
	@bash -c 'trap "" INT; $(MAKE) --no-print-directory logs; code=$$?; trap - INT; [ "$$code" -eq 130 ] && exit 0; exit "$$code"'

docker: ## 🐳 Rebuild Docker containers only
	$(DOCKER_COMPOSE) down
	$(DOCKER_COMPOSE) up -d --build

frontend: ## ⚛️  Rebuild frontend only
	bash $(FRONT_SCRIPT)

logs: ## 📜 Follow Docker logs only
	@bash -c 'trap "" INT; bash -c '\''trap - INT; exec "$$@"'\'' sh $(DOCKER_COMPOSE) logs -f -t; code=$$?; trap - INT; [ "$$code" -eq 130 ] && exit 0; exit "$$code"'

##
## Docker
##

start: ## ▶️  Start containers
	$(DOCKER_COMPOSE) up -d

stop: ## ⏹️  Stop containers
	$(DOCKER_COMPOSE) down

restart: ## 🔁 Quick restart containers
	$(DOCKER_COMPOSE) restart

ps: ## 📦 Running containers
	$(DOCKER_COMPOSE) ps

status: ## ❤️  All containers
	$(DOCKER_COMPOSE) ps --all

clean: ## 🧹 Remove unused Docker resources
	@bash -c '\
		output_file=$$(mktemp); \
		printf "Please wait. Cleaning unused Docker resources...\n"; \
		docker system prune -f > "$$output_file" 2>&1 & \
		pid=$$!; \
		stop_child() { kill "$$pid" 2>/dev/null || true; wait "$$pid" 2>/dev/null || true; rm -f "$$output_file"; exit 0; }; \
		trap stop_child INT; \
		frame=0; \
		while kill -0 "$$pid" 2>/dev/null; do \
			filled=$$((frame % 21)); \
			bar=""; \
			i=0; \
			while [ "$$i" -lt "$$filled" ]; do bar="$${bar}#"; i=$$((i + 1)); done; \
			printf "\r[%-20s] In progress..." "$$bar"; \
			frame=$$((frame + 1)); \
			sleep 0.2; \
		done; \
		wait "$$pid"; \
		code=$$?; \
		printf "\r[####################] Done.          \n"; \
		cat "$$output_file"; \
		rm -f "$$output_file"; \
		exit "$$code"; \
	'

checkout: ## 🔀 Switch branch or release tag
	@bash -c '\
		trap "printf \"\\n\"; exit 0" INT; \
		printf "Fetching branches and tags from origin...\n"; \
		git fetch --prune --tags origin 2>/dev/null || git fetch --tags 2>/dev/null || true; \
		branches=$$( { git for-each-ref --format="%(refname:short)" refs/heads/; git for-each-ref --format="%(refname:short)" refs/remotes/origin/ 2>/dev/null | grep -v "^origin/HEAD$$" | sed "s|^origin/||"; } | awk "!seen[\$$0]++" ); \
		tags=$$(git tag -l --sort=-v:refname 2>/dev/null || git tag -l 2>/dev/null); \
		curr_branch=$$(git branch --show-current 2>/dev/null); \
		curr_tag=""; \
		[ -z "$$curr_branch" ] && curr_tag=$$(git describe --tags --exact-match 2>/dev/null || true); \
		item_names=(); \
		item_types=(); \
		if [ -n "$$branches" ]; then \
			while IFS= read -r b || [ -n "$$b" ]; do \
				[ -n "$$b" ] || continue; \
				item_names+=("$$b"); \
				item_types+=("branch"); \
			done <<< "$$branches"; \
		fi; \
		if [ -n "$$tags" ]; then \
			while IFS= read -r t || [ -n "$$t" ]; do \
				[ -n "$$t" ] || continue; \
				item_names+=("$$t"); \
				item_types+=("tag"); \
			done <<< "$$tags"; \
		fi; \
		total="$${#item_names[@]}"; \
		if [ "$$total" -eq 0 ]; then \
			printf "No branches or tags found\n"; \
			exit 1; \
		fi; \
		num=1; \
		printf "\n\033[1mBranches:\033[0m\n"; \
		branch_count=0; \
		for i in "$${!item_names[@]}"; do \
			if [ "$${item_types[$$i]}" = "branch" ]; then \
				name="$${item_names[$$i]}"; \
				branch_count=$$((branch_count + 1)); \
				cur=""; \
				[ "$$name" = "$$curr_branch" ] && cur=" \033[32m(current)\033[0m"; \
				printf "  \033[36m%2d)\033[0m %s%b\n" "$$num" "$$name" "$$cur"; \
				num=$$((num + 1)); \
			fi; \
		done; \
		[ "$$branch_count" -eq 0 ] && printf "  (none)\n"; \
		printf "\n\033[1mTags:\033[0m\n"; \
		tag_count=0; \
		for i in "$${!item_names[@]}"; do \
			if [ "$${item_types[$$i]}" = "tag" ]; then \
				name="$${item_names[$$i]}"; \
				tag_count=$$((tag_count + 1)); \
				cur=""; \
				[ -z "$$curr_branch" ] && [ "$$name" = "$$curr_tag" ] && cur=" \033[32m(current)\033[0m"; \
				printf "  \033[36m%2d)\033[0m %s%b\n" "$$num" "$$name" "$$cur"; \
				num=$$((num + 1)); \
			fi; \
		done; \
		[ "$$tag_count" -eq 0 ] && printf "  (none)\n"; \
		printf "\nSelect branch or tag number (q to quit): "; \
		read -r choice; \
		case "$$choice" in q|Q) exit 0 ;; esac; \
		case "$$choice" in *[!0-9]*|"") printf "Invalid choice\n"; exit 1 ;; esac; \
		if [ "$$choice" -lt 1 ] || [ "$$choice" -gt "$$total" ]; then \
			printf "Invalid choice\n"; \
			exit 1; \
		fi; \
		idx=$$((choice - 1)); \
		target_type="$${item_types[$$idx]}"; \
		target_name="$${item_names[$$idx]}"; \
		if [ "$$target_type" = "branch" ]; then \
			printf "Switching to branch %s...\n" "$$target_name"; \
			git checkout "$$target_name" || exit 1; \
			if git show-ref --verify --quiet "refs/remotes/origin/$$target_name"; then \
				git pull origin "$$target_name" || true; \
			else \
				git pull 2>/dev/null || true; \
			fi; \
		else \
			printf "Switching to tag %s...\n" "$$target_name"; \
			git checkout "refs/tags/$$target_name" 2>/dev/null || git checkout "$$target_name" || exit 1; \
		fi; \
	'

switch: checkout
branch: checkout

update: ## 🌿 Pull current branch or replace it with origin/current
	@bash -c '\
		branch="$$(git branch --show-current)"; \
		[ -n "$$branch" ] || { printf "Not on a branch\n"; exit 1; }; \
		git pull && exit 0; \
		printf "\nDelete local %s and switch to origin/%s? [y/N] " "$$branch" "$$branch"; \
		read -r answer; \
		case "$$answer" in y|Y|yes|YES) ;; *) printf "Skipped\n"; exit 1 ;; esac; \
		git merge --abort 2>/dev/null || true; \
		git rebase --abort 2>/dev/null || true; \
		git fetch origin "$$branch"; \
		git show-ref --verify --quiet "refs/remotes/origin/$$branch" || { printf "origin/%s not found\n" "$$branch"; exit 1; }; \
		git reset --hard; \
		git switch --detach; \
		git branch -D "$$branch"; \
		git switch --track -c "$$branch" "origin/$$branch"; \
	'

alias: ## ⚡ Add/remove 'st' command for 'make'
	@bash -c '\
		marker="STEALTHNET st wrapper"; \
		st_path="$$(command -v st 2>/dev/null || true)"; \
		if [ -n "$$st_path" ]; then \
			if ! grep -q "$$marker" "$$st_path" 2>/dev/null; then \
				printf "Command st already exists at %s\n" "$$st_path"; \
				exit 0; \
			fi; \
			printf "Command st already exists at %s. Remove it? [y/N] " "$$st_path"; \
			read -r answer; \
			case "$$answer" in y|Y|yes|YES) ;; *) printf "Skipped\n"; exit 0 ;; esac; \
			rm -f "$$st_path"; \
			printf "Removed\n"; \
			exit 0; \
		fi; \
		install_dir=""; \
		for dir in /usr/local/bin $$(printf "%s" "$$PATH" | tr : " "); do \
			[ -n "$$dir" ] && [ -d "$$dir" ] && [ -w "$$dir" ] && install_dir="$$dir" && break; \
		done; \
		if [ -z "$$install_dir" ]; then \
			printf "No writable directory found in PATH\n"; \
			exit 1; \
		fi; \
		printf "Add command st to %s? [y/N] " "$$install_dir"; \
		read -r answer; \
		case "$$answer" in y|Y|yes|YES) ;; *) printf "Skipped\n"; exit 0 ;; esac; \
		{ \
			printf "#!/usr/bin/env bash\n"; \
			printf "# %s\n" "$$marker"; \
			printf "exec make \"\\044@\"\n"; \
		} > "$$install_dir/st"; \
		chmod +x "$$install_dir/st"; \
		printf "Added\n"; \
	'
