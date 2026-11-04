export type KnowledgeTemplate = {
  id: string;
  language: string;
  summary: string;
  title: string;
  content: string;
};

type TemplateDefinition = Pick<KnowledgeTemplate, "id" | "language" | "summary"> & {
  conventions: string[];
  reliability: string[];
  testing: string[];
  reference?: { label: string; url: string };
};

function defineTemplate(definition: TemplateDefinition): KnowledgeTemplate {
  const title = `${definition.language} coding standards`;
  const section = (heading: string, rules: string[]) => `## ${heading}\n\n${rules.map((rule) => `- ${rule}`).join("\n")}`;
  return {
    id: definition.id,
    language: definition.language,
    summary: definition.summary,
    title,
    content: [
      `# ${title}`,
      "## Scope\n\nThese are editable team defaults, not an official language standard. Apply them to this language in the workspace. Follow the repository's supported runtime, formatter, linter, and documented conventions when they differ. Review changed code; avoid unrelated style rewrites.",
      section("Conventions and design", definition.conventions),
      section("Correctness and error handling", definition.reliability),
      section("Security and boundaries", [
        "Validate untrusted input at application boundaries and enforce authorization before reading or changing protected data.",
        "Use parameterized database queries. Keep credentials and personal data out of source code, error responses, and logs.",
        "Bound external work with appropriate timeouts and size limits. Retry only when the operation is safe to repeat.",
      ]),
      section("Testing and review", [
        ...definition.testing,
        "Test changed behavior, including relevant failure paths and boundary cases. Keep tests deterministic and independent of live external services.",
        "Run the repository's configured checks. Explain compatibility changes and document non-obvious tradeoffs.",
      ]),
      ...(definition.reference ? [`## Further reading\n\n[${definition.reference.label}](${definition.reference.url})`] : []),
    ].join("\n\n") + "\n",
  };
}

export const knowledgeTemplates: readonly KnowledgeTemplate[] = [
  {
    id: "typescript", language: "TypeScript", summary: "Type safety, narrowing, and async boundaries",
    conventions: [
      "Use strict type checking for new code. Prefer unknown over any at untrusted boundaries and narrow values before use.",
      "Model distinct states with discriminated unions. Avoid non-null assertions and casts that hide missing validation.",
      "Keep public contracts explicit and implementation types inferred where clear. Use readonly where mutation is not part of the contract.",
    ],
    reliability: [
      "Validate parsed JSON and API inputs at runtime; TypeScript annotations do not validate external data.",
      "Await or explicitly handle every promise. Preserve error causes and distinguish expected failures from programming errors.",
      "Handle null, undefined, and empty collections deliberately. Use exhaustive handling for closed sets of states.",
    ],
    testing: ["Run the configured TypeScript check and lint rules. Test runtime validation as well as typed happy paths."],
    reference: { label: "TypeScript handbook: narrowing", url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html" },
  },
  {
    id: "javascript", language: "JavaScript", summary: "Clear modules, promises, and input validation",
    conventions: [
      "Prefer const; use let for reassignment. Keep the repository's module format and supported runtime targets.",
      "Use strict equality unless coercion is deliberate and documented. Name functions for their behavior and keep side effects explicit.",
      "Document public inputs and return values with JSDoc where types would otherwise be unclear. Avoid mutating caller-owned objects unexpectedly.",
    ],
    reliability: [
      "Await promises or attach an explicit rejection handler; do not use async callbacks with forEach when completion must be awaited.",
      "Validate external data before use. Distinguish missing values from valid falsy values such as zero and false.",
      "Clean up event listeners, timers, and subscriptions when their owner is disposed. Avoid blocking the event loop with large synchronous work.",
    ],
    testing: ["Run configured lint and test commands. Cover rejected promises, coercion boundaries, and cleanup behavior when relevant."],
  },
  {
    id: "python", language: "Python", summary: "Typed interfaces, exceptions, and resource cleanup",
    conventions: [
      "Follow the configured formatter and PEP 8 naming conventions: snake_case for functions and variables, PascalCase for classes.",
      "Add type annotations to public interfaces and non-trivial functions. Keep imports explicit and avoid wildcard imports.",
      "Avoid mutable default arguments. Prefer small functions and explicit data structures over hidden global state.",
    ],
    reliability: [
      "Catch specific exceptions and preserve the original cause when translating errors. Do not silently swallow failures.",
      "Use context managers for files, locks, and other managed resources. Keep blocking I/O out of async event loops.",
      "Use timezone-aware values for timestamps representing instants. Validate missing keys and empty sequences at boundaries.",
    ],
    testing: ["Use the project's test runner and configured type checker. Isolate time, filesystem, and network dependencies with fixtures."],
  },
  {
    id: "go", language: "Go", summary: "Explicit errors, context, and goroutine lifetimes",
    conventions: [
      "Format code with gofmt. Keep package names short and exported APIs documented where their purpose is not obvious.",
      "Define small interfaces at the consumer boundary. Prefer straightforward composition over unnecessary abstractions.",
      "Make ownership of resources and goroutines explicit. Keep shared mutable state protected by a documented synchronization strategy.",
    ],
    reliability: [
      "Check returned errors. Wrap errors with useful context while preserving identity when callers need errors.Is or errors.As.",
      "Propagate context.Context through request-scoped operations and honor cancellation. Give each goroutine a bounded lifetime and exit path.",
      "Close acquired resources on every path. Avoid panic for expected input or operational failures.",
    ],
    testing: ["Use table-driven tests for meaningful input variations. Run go test and go vet; use the race detector for affected concurrent code where supported."],
    reference: { label: "Effective Go", url: "https://go.dev/doc/effective_go" },
  },
  {
    id: "java", language: "Java", summary: "Encapsulation, resource safety, and exceptions",
    conventions: [
      "Follow the project's Java version and formatter. Use UpperCamelCase for types and lowerCamelCase for methods and variables.",
      "Prefer immutable state and constructor-injected dependencies. Keep fields private and expose behavior through focused APIs.",
      "Use generics without raw types. Make nullability explicit using the project's established annotations or API conventions.",
    ],
    reliability: [
      "Use try-with-resources for AutoCloseable resources. Catch specific exceptions and preserve causes when translating them.",
      "Do not swallow InterruptedException; propagate it or restore the interrupt flag when it cannot be propagated.",
      "Protect shared mutable state. Keep blocking work and transaction boundaries explicit; avoid unbounded background task creation.",
    ],
    testing: ["Run the configured build and test suite. Test exception paths and transaction rollback where behavior depends on them."],
  },
  {
    id: "csharp", language: "C#", summary: "Nullable contracts, async work, and disposal",
    conventions: [
      "Follow .editorconfig and the project's language version. Use PascalCase for public members and camelCase for parameters and locals.",
      "Use nullable reference annotations when enabled and resolve warnings without hiding them with the null-forgiving operator.",
      "Prefer focused interfaces, constructor injection, and immutable data when updates are not needed.",
    ],
    reliability: [
      "Return Task or Task<T> from asynchronous work; reserve async void for event handlers. Avoid blocking on Task.Result or Wait in async paths.",
      "Propagate CancellationToken where cancellation is supported. Dispose resources with using or await using as appropriate.",
      "Preserve stack traces when rethrowing. Avoid catching all exceptions unless the boundary can handle or report the failure correctly.",
    ],
    testing: ["Run the configured .NET build, analyzers, and tests. Cover null inputs, cancellation, and resource disposal where relevant."],
  },
  {
    id: "c", language: "C", summary: "Buffer bounds, ownership, and undefined behavior",
    conventions: [
      "Use the repository's C standard, naming rules, and formatter. Keep headers minimal and declarations consistent with definitions.",
      "Document pointer ownership, lifetimes, nullability, and buffer lengths at API boundaries. Use const for read-only access.",
      "Use size_t for object sizes and check conversions between signed and unsigned values.",
    ],
    reliability: [
      "Check allocation and I/O results. Release acquired resources on every exit path and initialize values before reading them.",
      "Check buffer bounds, arithmetic overflow, and string termination before copying or indexing. Never use unbounded input operations.",
      "Avoid undefined behavior, dangling pointers, double frees, and data races. Keep error codes and cleanup responsibilities explicit.",
    ],
    testing: ["Build with the project's warning settings. Run relevant sanitizers and static analysis where supported; test zero-length, maximum-size, and failed-allocation paths."],
  },
  {
    id: "cpp", language: "C++", summary: "RAII, value semantics, and lifetime safety",
    conventions: [
      "Follow the configured C++ standard and formatter. Prefer value semantics and the rule of zero when standard types can manage resources.",
      "Use RAII for resources and unique_ptr for exclusive dynamic ownership. Use shared_ptr only when ownership is genuinely shared.",
      "Prefer standard containers and algorithms over manual memory management. Make non-owning references and views explicit.",
    ],
    reliability: [
      "Check reference, iterator, span, and string_view lifetimes; do not return views into destroyed storage.",
      "Define exception guarantees for operations that mutate state. Keep destructors non-throwing and cleanup reliable on all exits.",
      "Avoid unchecked indexing, narrowing conversions, and undefined behavior. Synchronize shared mutable state.",
    ],
    testing: ["Run configured compiler warnings, static analysis, and tests. Use supported sanitizers for lifetime, bounds, and concurrency changes."],
  },
  {
    id: "rust", language: "Rust", summary: "Ownership, recoverable errors, and safe boundaries",
    conventions: [
      "Use cargo fmt and the configured Clippy rules. Express ownership clearly and borrow when transferring ownership is unnecessary.",
      "Model valid states with enums and focused types. Avoid clones introduced only to bypass an unclear ownership design.",
      "Keep unsafe blocks small and document the safety invariants that callers and implementations must maintain.",
    ],
    reliability: [
      "Return Result for recoverable failures and Option for absence. Propagate errors with context while preserving useful error information.",
      "Avoid unwrap and expect on untrusted input or expected operational failures; document invariants for justified uses.",
      "Avoid holding blocking locks across await points. Bound spawned tasks and account for cancellation and cleanup.",
    ],
    testing: ["Run cargo test and the repository's lint checks. Test error variants, empty inputs, and ownership-sensitive boundary behavior."],
    reference: { label: "The Rust book: error handling", url: "https://doc.rust-lang.org/book/ch09-00-error-handling.html" },
  },
  {
    id: "php", language: "PHP", summary: "Typed boundaries, validation, and safe output",
    conventions: [
      "Follow the project's PHP version, Composer autoloading, and formatter. Keep namespaces and file paths consistent.",
      "Declare parameter and return types where practical. Use strict_types consistently with the project's policy.",
      "Keep business logic separate from HTTP handlers and templates. Inject dependencies instead of relying on hidden globals.",
    ],
    reliability: [
      "Validate request data before using it; type declarations are not a substitute for domain validation.",
      "Handle exceptions at an appropriate boundary and return safe error responses. Avoid suppressing failures with the @ operator.",
      "Escape output for its destination context. Use prepared database statements and avoid unsafe deserialization of untrusted data.",
    ],
    testing: ["Run the project's tests and configured static analyzer. Cover validation failures, authorization, and transaction rollback where applicable."],
  },
  {
    id: "ruby", language: "Ruby", summary: "Small objects, explicit errors, and predictable state",
    conventions: [
      "Follow the configured formatter and lint rules. Use snake_case for methods and variables and CamelCase for classes and modules.",
      "Keep objects focused and dependencies explicit. Avoid surprising monkey patches and metaprogramming when ordinary methods suffice.",
      "Use bang method names consistently with the project's conventions and document destructive behavior.",
    ],
    reliability: [
      "Rescue specific StandardError subclasses where recovery is possible; do not rescue Exception for routine application failures.",
      "Use block-based resource management for files and locks. Avoid mutating shared constants or caller-owned collections unexpectedly.",
      "Distinguish nil from false when applying defaults. Keep database transactions and external side effects deliberately ordered.",
    ],
    testing: ["Run the project's test runner and lint rules. Cover nil, false, empty collections, and failure behavior where relevant."],
  },
  {
    id: "swift", language: "Swift", summary: "Optionals, actor isolation, and task ownership",
    conventions: [
      "Follow the project's Swift version and formatter. Use UpperCamelCase for types and lowerCamelCase for functions and properties.",
      "Prefer value types when identity and shared mutation are unnecessary. Keep access levels as narrow as the API permits.",
      "Unwrap optionals with guard, if let, or explicit defaults. Avoid force-unwrapping values from external data.",
    ],
    reliability: [
      "Represent recoverable failures with throwing functions or explicit result types; avoid try! for operations that can fail normally.",
      "Respect actor isolation and keep UI updates on the main actor. Treat Sendable conformance as a real concurrency contract.",
      "Give tasks clear owners, propagate cancellation, and check escaping closures for retain cycles. Avoid detached tasks without a lifecycle reason.",
    ],
    testing: ["Use the project's Swift test framework. Cover optional and error paths, cancellation, and relevant isolation-sensitive behavior."],
  },
  {
    id: "kotlin", language: "Kotlin", summary: "Null safety, sealed states, and structured concurrency",
    conventions: [
      "Follow the project's Kotlin version and formatter. Prefer val and immutable collections unless mutation is part of the design.",
      "Model distinct states with sealed types where appropriate. Keep extension functions focused and avoid surprising global behavior.",
      "Use nullable types deliberately and handle them explicitly. Avoid !! for external or lifecycle-dependent values.",
    ],
    reliability: [
      "Use structured concurrency with scopes owned by the relevant lifecycle. Avoid GlobalScope for ordinary application work.",
      "Preserve coroutine cancellation; rethrow CancellationException when catching broad exception types around suspending work.",
      "Use use for closeable resources and an appropriate dispatcher for blocking I/O. Handle Java platform types at interop boundaries.",
    ],
    testing: ["Run configured checks and tests. Use controlled coroutine schedulers when testing asynchronous code and include cancellation paths."],
    reference: { label: "Kotlin: cancellation and timeouts", url: "https://kotlinlang.org/docs/cancellation-and-timeouts.html" },
  },
  {
    id: "dart", language: "Dart", summary: "Sound null safety, futures, and lifecycle cleanup",
    conventions: [
      "Use dart format and the project's analyzer rules. Use UpperCamelCase for types, lowerCamelCase for members, and lower_case_with_underscores for file names.",
      "Prefer final for values assigned once and const where appropriate. Keep public APIs typed and avoid unnecessary dynamic values.",
      "Use sound null safety and explicit handling of absent values. Avoid ! and late when initialization cannot be guaranteed.",
    ],
    reliability: [
      "Await futures or explicitly handle their failures. Close owned streams and cancel subscriptions when their owner is disposed.",
      "Keep expensive synchronous work off latency-sensitive event loops. Preserve error context when translating failures.",
      "In Flutter code, respect widget lifecycles: dispose owned controllers and check mounted before using a context after an asynchronous gap.",
    ],
    testing: ["Run dart analyze and the project's test command. For Flutter changes, cover state transitions and lifecycle cleanup with appropriate widget tests."],
  },
].map(defineTemplate);
