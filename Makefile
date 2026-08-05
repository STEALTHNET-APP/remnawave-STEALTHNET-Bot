.PHONY: menu watch rebuild docker frontend logs start stop restart \
        ps status clean reset-dev alias

DOCKER_COMPOSE := docker compose
FRONT_SCRIPT := ./scripts/update-front-with-external-nginx.sh
MENU_TARGETS := rebuild watch docker frontend logs start stop restart ps status clean reset-dev alias

.DEFAULT_GOAL := menu

menu: ## 🧭 Interactive command menu
	@bash -c '\
		trap "printf \"\\n\"; exit 0" INT; \
		targets="$(MENU_TARGETS)"; \
		printf "\n\033[1;36m"; \
		printf " ███████╗████████╗███████╗ █████╗ ██╗  ████████╗██╗  ██╗███╗   ██╗███████╗████████╗\n"; \
		printf " ██╔════╝╚══██╔══╝██╔════╝██╔══██╗██║  ╚══██╔══╝██║  ██║████╗  ██║██╔════╝╚══██╔══╝\n"; \
		printf " ███████╗   ██║   █████╗  ███████║██║     ██║   ███████║██╔██╗ ██║█████╗     ██║\n"; \
		printf " ╚════██║   ██║   ██╔══╝  ██╔══██║██║     ██║   ██╔══██║██║╚██╗██║██╔══╝     ██║\n"; \
		printf " ███████║   ██║   ███████╗██║  ██║███████╗██║   ██║  ██║██║ ╚████║███████╗   ██║\n"; \
		printf " ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝\n"; \
		printf "\033[0m\n"; \
		printf "\033[1mSelect command:\033[0m\n\n"; \
		i=1; \
		for target in $$targets; do \
			desc=$$(awk -v target="$$target" '\''BEGIN {FS=":.*##"} $$1 == target {gsub(/^[ \t]+/, "", $$2); print $$2; exit}'\'' $(MAKEFILE_LIST)); \
			printf "  \033[36m%2d)\033[0m %-12s %s\n" "$$i" "$$target" "$$desc"; \
			i=$$((i + 1)); \
		done; \
		printf "\nCommand number (q to quit): "; \
		read -r choice; \
		case "$$choice" in q|Q) exit 0 ;; esac; \
		case "$$choice" in *[!0-9]*|"") printf "Invalid choice\n"; exit 1 ;; esac; \
		set -- $$targets; \
		if [ "$$choice" -lt 1 ] || [ "$$choice" -gt "$$#" ]; then \
			printf "Invalid choice\n"; \
			exit 1; \
		fi; \
		eval selected="\$${$$choice}"; \
		trap "" INT; \
		bash -c '\''trap - INT; exec "$$@"'\'' sh $(MAKE) --no-print-directory "$$selected"; \
		code=$$?; \
		trap - INT; \
		[ "$$code" -eq 130 ] && exit 0; \
		exit "$$code"; \
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

start:  ## ▶️ Start containers
	$(DOCKER_COMPOSE) up -d

stop:  ## ⏹️ Stop containers
	$(DOCKER_COMPOSE) down

restart: ## 🔁 Quick restart containers
	$(DOCKER_COMPOSE) restart

ps: ## 📦 Running containers
	$(DOCKER_COMPOSE) ps

status:  ## ❤️ All containers
	$(DOCKER_COMPOSE) ps --all

clean: ## 🧹 Remove unused Docker resources
	docker system prune -f

reset-dev: ## 🌿 Replace local dev with origin/dev
	@bash -c '\
		printf "Delete local dev and switch to origin/dev? [y/N] "; \
		read -r answer; \
		case "$$answer" in y|Y|yes|YES) ;; *) printf "Skipped\n"; exit 0 ;; esac; \
		git diff --quiet && git diff --cached --quiet || { printf "Working tree has uncommitted changes\n"; exit 1; }; \
		git fetch origin dev; \
		if git show-ref --verify --quiet refs/heads/dev; then \
			[ "$$(git branch --show-current)" = dev ] && git switch --detach; \
			git branch -D dev; \
		fi; \
		git switch --track -c dev origin/dev; \
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