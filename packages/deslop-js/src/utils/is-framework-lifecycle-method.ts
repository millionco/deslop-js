/**
 * Methods invoked by-name by frameworks rather than by user code, so static
 * "no caller" analysis would falsely flag them as unused class members.
 *
 * Allowlist of framework-invoked lifecycle methods:
 *
 * - React class component lifecycle hooks (Component / PureComponent / error
 *   boundaries) and the `getDerivedState*` static factories
 * - Angular component / directive / pipe / guard / resolver / interceptor /
 *   ControlValueAccessor lifecycle and framework callbacks
 *
 * Names are framework-agnostic strings — we don't try to verify the class
 * actually extends `React.Component` or has `@Component` because that would
 * require type-aware analysis on every code-base shape; instead we treat the
 * names as a global allowlist, matching how the frameworks themselves invoke
 * them.
 */
const REACT_LIFECYCLE_METHODS = new Set<string>([
  "render",
  "componentDidMount",
  "componentDidUpdate",
  "componentWillUnmount",
  "shouldComponentUpdate",
  "getSnapshotBeforeUpdate",
  "getDerivedStateFromProps",
  "getDerivedStateFromError",
  "componentDidCatch",
  "componentWillMount",
  "componentWillReceiveProps",
  "componentWillUpdate",
  "UNSAFE_componentWillMount",
  "UNSAFE_componentWillReceiveProps",
  "UNSAFE_componentWillUpdate",
  "getChildContext",
  "contextType",
]);

const ANGULAR_LIFECYCLE_METHODS = new Set<string>([
  "ngOnInit",
  "ngOnDestroy",
  "ngOnChanges",
  "ngDoCheck",
  "ngAfterContentInit",
  "ngAfterContentChecked",
  "ngAfterViewInit",
  "ngAfterViewChecked",
  "ngAcceptInputType",
  "canActivate",
  "canDeactivate",
  "canActivateChild",
  "canMatch",
  "resolve",
  "intercept",
  "transform",
  "validate",
  "registerOnChange",
  "registerOnTouched",
  "writeValue",
  "setDisabledState",
]);

export const isReactLifecycleMethod = (name: string): boolean =>
  REACT_LIFECYCLE_METHODS.has(name);

export const isAngularLifecycleMethod = (name: string): boolean =>
  ANGULAR_LIFECYCLE_METHODS.has(name);

export const isFrameworkLifecycleMethod = (name: string): boolean =>
  REACT_LIFECYCLE_METHODS.has(name) || ANGULAR_LIFECYCLE_METHODS.has(name);
