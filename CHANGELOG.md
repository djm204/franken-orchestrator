# Changelog

## [0.2.0](https://github.com/djm204/franken-orchestrator/compare/franken-orchestrator-v0.1.0...franken-orchestrator-v0.2.0) (2026-03-08)


### Features

* add --cleanup flag and "made with Frankenbeast" branding ([2402531](https://github.com/djm204/franken-orchestrator/commit/24025314897e1c04a3a2e6f51d57e0f9605d2fc3))
* add beast-logger module and build-runner integration tests ([7e9d16b](https://github.com/djm204/franken-orchestrator/commit/7e9d16b61f5080a9fc3c322271783f95f9206dcc))
* add ChunkFileGraphBuilder for Mode 1 chunk-based planning ([dbc5b34](https://github.com/djm204/franken-orchestrator/commit/dbc5b34bbd4e258af635484d34d3d1173f85ff91))
* add CLI skill types and extend SkillDescriptor with 'cli' execution type ([2734efa](https://github.com/djm204/franken-orchestrator/commit/2734efaa2b85dadb225d33d10aacdd9ec5b16fdc))
* add CliObserverBridge types, implementation, and tests ([db70211](https://github.com/djm204/franken-orchestrator/commit/db70211e79c0c58d3661971c576add7123559ebc))
* add CliSkillExecutor with observer integration (chunk 04) ([384fa0f](https://github.com/djm204/franken-orchestrator/commit/384fa0f9681e358e8e549f2af1ada694d0580d0e))
* add design doc persistence (file-writer + project-root) ([1b5485f](https://github.com/djm204/franken-orchestrator/commit/1b5485fe699d4d5c5d0550ffcf26a07592743056))
* add E2E pipeline proof test (chunk 11) ([1ab18cc](https://github.com/djm204/franken-orchestrator/commit/1ab18cc2d669ae7413e4d04ed1d0a04a08e796e3))
* add E2E tracer bullet test for CLI pipeline wiring ([31fff03](https://github.com/djm204/franken-orchestrator/commit/31fff03c9be50e8bc54f75f74ce02e89e0b35716))
* add GitBranchIsolator with TDD tests (chunk 03) ([d5317f9](https://github.com/djm204/franken-orchestrator/commit/d5317f98fd4177f83db556ed9aead06de57f11d2))
* add GitHub issue types and port interfaces ([1efed7c](https://github.com/djm204/franken-orchestrator/commit/1efed7c8743c36ad15ef9d0c876ad2a5cc69d884))
* add ICheckpointStore interface + FileCheckpointStore ([e7fbaf5](https://github.com/djm204/franken-orchestrator/commit/e7fbaf5595ffc61450b03eb3db8fbe8a084b6aaf))
* add InterviewLoop — Mode 3 interview-to-design-doc pipeline ([8dec082](https://github.com/djm204/franken-orchestrator/commit/8dec082e81446b586490e977f3f00834f9876f26))
* add LLM-driven merge conflict resolution to CliSkillExecutor ([ac348ae](https://github.com/djm204/franken-orchestrator/commit/ac348ae7ddf75b610a65b1e9fd6499400fff68f9))
* add observer bridge hardening & integration tests (chunk 05) ([ccd7680](https://github.com/djm204/franken-orchestrator/commit/ccd768066c410bca7afd358fba947d8c40c1410b))
* add RalphLoop core class with TDD tests (chunk 02) ([363b1eb](https://github.com/djm204/franken-orchestrator/commit/363b1ebe95782726845f04d969b069446f033dfc))
* **cli-executor:** wire commit message generation before squash merge ([01c5014](https://github.com/djm204/franken-orchestrator/commit/01c50146723d28fd9b9944caf1212f1a663c8762))
* **cli-output:** buffer stream-json, emit clean text, add iteration progress ([6c847a8](https://github.com/djm204/franken-orchestrator/commit/6c847a82ad367dd8656830b19028cd4945bc7128))
* **cli:** add base branch detection and resolution ([ca85897](https://github.com/djm204/franken-orchestrator/commit/ca85897bd4be0dfa521091565e905c5c3794a767))
* **cli:** add project root detection and .frankenbeast/ scaffolding ([5876ee2](https://github.com/djm204/franken-orchestrator/commit/5876ee2724e66f9257bb57917dac453f0b645d3a))
* **cli:** add Spinner utility for CLI progress feedback ([d26bb05](https://github.com/djm204/franken-orchestrator/commit/d26bb05af973ae24b4916cd7a6e074c60df3da4a))
* **config:** add providers config schema, widen CLI args, update types ([280349c](https://github.com/djm204/franken-orchestrator/commit/280349ce2c07b686273761b85dfcf4453ac27aa2))
* **config:** wire config-loader into run.ts and expand SessionConfig ([99beadf](https://github.com/djm204/franken-orchestrator/commit/99beadf1c00cb05fb7ad443b253db6f15cfd3a74))
* fix ralph loop freeze, checkpoint recovery, and PR descriptions ([e6acc2c](https://github.com/djm204/franken-orchestrator/commit/e6acc2c85dcb664880e3eb3a2c3258d173846204))
* fix ralph loop freeze, checkpoint recovery, and PR descriptions ([b280266](https://github.com/djm204/franken-orchestrator/commit/b2802669e4c608752d4300baacdceb99a86b2c76))
* **git-isolator:** add squash merge with optional commit message ([0b093bb](https://github.com/djm204/franken-orchestrator/commit/0b093bb27938f04d1c916c151769cc2e075f81c0))
* implement CliLlmAdapter execute/transformRequest/transformResponse ([b20768d](https://github.com/djm204/franken-orchestrator/commit/b20768dccf1e7389b5ad2a26df35523d73e1c3b5))
* implement IssueFetcher wrapping gh CLI for GitHub issue fetching ([d95a21a](https://github.com/djm204/franken-orchestrator/commit/d95a21ac9568aa8a148271389b718fabcab00309))
* implement IssueRunner outer loop orchestrator ([01e6cb0](https://github.com/djm204/franken-orchestrator/commit/01e6cb0b1cac66a4657b927357c67dd8ef2e3933))
* implement IssueTriage LLM complexity assessment ([2ebb6a7](https://github.com/djm204/franken-orchestrator/commit/2ebb6a7ede677660e7e07926e68e9f33ad8ccec3))
* **orchestrator:** add complex port adapters ([e08429c](https://github.com/djm204/franken-orchestrator/commit/e08429cbe920029920ff8d79c8978f9374f6e5ae))
* **orchestrator:** add LLM skill handler and planner ([1dcc108](https://github.com/djm204/franken-orchestrator/commit/1dcc108bd44bf71a20841b79eb4daf5dce469830))
* pass CLI provider defaults through to CliSkillExecutor ([53eaff0](https://github.com/djm204/franken-orchestrator/commit/53eaff0f3887bd8b73ebbe3ff35ed3f0ed8a322c))
* **PR-25:** orchestrator scaffold + FrankenContext ([3a41608](https://github.com/djm204/franken-orchestrator/commit/3a4160886cd33c2933b6da8150b282e351448906))
* **PR-26:** ingestion + hydration phases (Beast Loop Phase 1) ([a246eac](https://github.com/djm204/franken-orchestrator/commit/a246eac4283ad37a63330ee0eaf95e7418890526))
* **PR-27:** recursive planning phase (Beast Loop Phase 2) ([18b3ac3](https://github.com/djm204/franken-orchestrator/commit/18b3ac3453047dc33657b145fa305ddc8e83dbf6))
* **PR-28:** validated execution phase (Beast Loop Phase 3) ([0525dce](https://github.com/djm204/franken-orchestrator/commit/0525dce83bc9d870de93b88bbb10ec9e0ac247d5))
* **PR-29:** observability + closure phase (Beast Loop Phase 4) ([0ab520d](https://github.com/djm204/franken-orchestrator/commit/0ab520deb346d20af8347b174fc1ed672d295c58))
* **PR-30:** circuit breakers + BeastLoop orchestration ([6422d87](https://github.com/djm204/franken-orchestrator/commit/6422d87163eb79cc99ef51b545eac5f4175029cf))
* **PR-39:** resilience — context serialization, graceful shutdown, health checks ([cde0dc4](https://github.com/djm204/franken-orchestrator/commit/cde0dc404369f9281734907fe58091693f0216ed))
* **PR-40:** CLI entry point with config loader ([c61b837](https://github.com/djm204/franken-orchestrator/commit/c61b837386caf48dae0044f52be2b626074ab063))
* **pr-creator:** add LLM-powered commit message generation ([ab0db7e](https://github.com/djm204/franken-orchestrator/commit/ab0db7e4d6590efb5e3e8947c42f2f25482ec35b))
* **pr-creator:** add LLM-powered PR description generation ([bc8020f](https://github.com/djm204/franken-orchestrator/commit/bc8020f71b86806bf5255e49c72996ea72f4e2fa))
* **pr-creator:** wire LLM generation into create() with static fallback ([cb3a7bb](https://github.com/djm204/franken-orchestrator/commit/cb3a7bb373a68b14ac195c2d1f409c4ffe36f413))
* refactor CliLlmAdapter to use ICliProvider injection ([013809d](https://github.com/djm204/franken-orchestrator/commit/013809dabd47b57b69a33c92730d97368ca99d39))
* refactor RalphLoop to use ProviderRegistry ([7835fd2](https://github.com/djm204/franken-orchestrator/commit/7835fd271ca6b603b010e43aa640c9d89252a83e))
* summarize tool-use events in stream output instead of dumping file contents ([068c3b0](https://github.com/djm204/franken-orchestrator/commit/068c3b0b6d8c1dfc3039b23ee90acc2bbf37d91f))
* wire BeastLoop deps and exports for CliSkillExecutor (chunk 06) ([fb98b40](https://github.com/djm204/franken-orchestrator/commit/fb98b408a8a8ea51ba97e6d6c54222c3827d759f))
* wire CliLlmAdapter into dep-factory and session ([bdd7d63](https://github.com/djm204/franken-orchestrator/commit/bdd7d63d7d61ce21e058bd68c2955219158f20bb))
* wire CliObserverBridge into dep-factory, add observer + budget tests ([4962207](https://github.com/djm204/franken-orchestrator/commit/49622072324772f2db41ce4546a679dd96e8844d))
* wire CliSkillExecutor into execution phase skill dispatch ([093b7e0](https://github.com/djm204/franken-orchestrator/commit/093b7e0584f89232cf0e486788f9c19801c344a0))
* wire interview UX into session flow ([01645aa](https://github.com/djm204/franken-orchestrator/commit/01645aa523d3ea091e63199a7b4eb15ce7c00712))
* wire issues subcommand into session and run pipeline ([198428b](https://github.com/djm204/franken-orchestrator/commit/198428bb3c07096162a5ccb7d6e5b29af76bf2ae))


### Bug Fixes

* align providersConfig types with exactOptionalPropertyTypes ([50d5c1b](https://github.com/djm204/franken-orchestrator/commit/50d5c1b0df07c90e97ac96a784b8364695760775))
* append newline to stream output lines in MartinLoop ([a516ce8](https://github.com/djm204/franken-orchestrator/commit/a516ce8592f195ba8eec027d7eac7f2e68247a2a))
* **cli-executor:** add undefined to CommitMessageFn field for exactOptionalPropertyTypes ([88b895f](https://github.com/djm204/franken-orchestrator/commit/88b895fb3c6b1255051c9683b40565d8e378d7d6))
* create baseBranch when it does not exist locally ([adaabee](https://github.com/djm204/franken-orchestrator/commit/adaabeed5c01448d58444b07350838ba29b260f2))
* emit warning when truncating chunks exceeding maxChunks limit ([e47c270](https://github.com/djm204/franken-orchestrator/commit/e47c270a83a127ad9936d108d837357ecdfb7344))
* handle untracked file conflicts in GitBranchIsolator checkout ([98555b4](https://github.com/djm204/franken-orchestrator/commit/98555b4c63ede23de6d1c7099435c80baa946253))
* import ILlmClient from @franken/types instead of duplicating locally ([3f63ad8](https://github.com/djm204/franken-orchestrator/commit/3f63ad8bb622a556316283c44897299639516ec4))
* PR creator falls back to main when branch equals target ([117d87e](https://github.com/djm204/franken-orchestrator/commit/117d87e8cad657e6ed7312b3e454b334943d2f00))
* prevent raw stream-JSON leaking into git commit messages ([b2dc8f2](https://github.com/djm204/franken-orchestrator/commit/b2dc8f225f3c93676cc4353f28bd287ca7fbe062))
* prevent raw stream-JSON leaking into git commit messages ([4fbd2da](https://github.com/djm204/franken-orchestrator/commit/4fbd2da4862b685f2029024b43521c995b34bee2)), closes [#92](https://github.com/djm204/franken-orchestrator/issues/92)
* **ralph-loop:** prevent plugin poisoning and false success reporting ([0c083f6](https://github.com/djm204/franken-orchestrator/commit/0c083f6c0ca38f6d9d938c071f715ac521516d31))
* remove --plugin-dir from buildClaudeArgs to fix prompt swallowing ([6504d76](https://github.com/djm204/franken-orchestrator/commit/6504d7657c33f2f16490e9fe62440704d994c24e))
* safe checkout — only remove expendable .build/ files on conflict ([869f2ea](https://github.com/djm204/franken-orchestrator/commit/869f2eaf9105e0cd7504e2f2e48465aa735ec630))
* skip PR creation when current branch equals target branch ([aeb3007](https://github.com/djm204/franken-orchestrator/commit/aeb3007ad7b4ea8dd439c10fde51c7c735fd67cb))
* strip hookSpecificOutput blocks from CLI response before parsing ([3458da1](https://github.com/djm204/franken-orchestrator/commit/3458da143af91780243603fadfc2283f972f5501))
* submodule-aware autoCommit, LLM PR wiring, broken test mocks ([7c4062d](https://github.com/djm204/franken-orchestrator/commit/7c4062d5eeaa06354d41112eb91ef7e8df057b2e))


### Miscellaneous

* add adapter stubs ([e03db13](https://github.com/djm204/franken-orchestrator/commit/e03db13128a464d2db7ea99079586f8b0c0eaebf))
* commit some half done stuff -- will get claude to fix after ([d4ad38a](https://github.com/djm204/franken-orchestrator/commit/d4ad38ad43af12fbad70885206709fe000c4aae5))
* verify chunk 07 session flow ([b4369b0](https://github.com/djm204/franken-orchestrator/commit/b4369b0cdb0ebff33eafac99f93b9e446e78f42e))
* verify chunk 11 rate limit resilience ([405c932](https://github.com/djm204/franken-orchestrator/commit/405c9327fb93b734efef2a1a0858994f16655439))


### Documentation

* add RAMP_UP.md for agent onboarding ([1d462f2](https://github.com/djm204/franken-orchestrator/commit/1d462f2e664c55327cfaa38e08fd1acc68e5f2a7))


### CI/CD

* add release-please config and workflow ([c7d150b](https://github.com/djm204/franken-orchestrator/commit/c7d150bfda259a5764abfb11b9fcc8c62e15ca2c))


### Tests

* add E2E test proving CLI skill execution through BeastLoop ([a984109](https://github.com/djm204/franken-orchestrator/commit/a9841091d2a7197b0425496be8ce4402d327abaf))
* add E2E tracer bullet for chunk file pipeline through BeastLoop ([615ad5c](https://github.com/djm204/franken-orchestrator/commit/615ad5cebe0fa8fc1b4634b58993e80c1d574fb3))
* build skill input with context and deps ([afcd2ab](https://github.com/djm204/franken-orchestrator/commit/afcd2ab78049e079f695f97300b52cdee98d12eb))
* call skills.execute for each required skill ([18967a4](https://github.com/djm204/franken-orchestrator/commit/18967a4840600c580c7942d7a8ec993d2bd0bcbe))
* fail when skill execution throws ([572e1fa](https://github.com/djm204/franken-orchestrator/commit/572e1faec44b65fd23dc91e3f1d37f85ffa43dd0))
* **orchestrator:** cover logger debug + blocked logs ([ab0d641](https://github.com/djm204/franken-orchestrator/commit/ab0d64174a26d493a6c72fd6010281d05e3f019c))
* **PR-36:** E2E test harness + unit tests ([a214c38](https://github.com/djm204/franken-orchestrator/commit/a214c38932ec72168fb2190eebcd317f3f448745))
* **PR-37/38:** E2E happy path, PII, critique retry, HITL, budget, injection ([42b32f0](https://github.com/djm204/franken-orchestrator/commit/42b32f0df57ee21a2484dcef80ae12b1a845f000))
* skip skill execution for passthrough tasks ([4a53157](https://github.com/djm204/franken-orchestrator/commit/4a53157907994895284e623f8ecc8f359a06155a))
* update existing PR creator test for main-to-main skip message ([99fadc3](https://github.com/djm204/franken-orchestrator/commit/99fadc3cdb9248fc1e768fab51189d8f137f2365))
* use skill output as task outcome ([1573e03](https://github.com/djm204/franken-orchestrator/commit/1573e03b86ad21accf3f9f0502fbddc9773bae62))


### Refactoring

* rename RalphLoop to MartinLoop across codebase ([9aa7b94](https://github.com/djm204/franken-orchestrator/commit/9aa7b944a4d84d7716645be5c5ba55b91288e883))
