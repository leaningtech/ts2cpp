/// <reference no-default-lib="true"/>

declare interface Outer extends Outer.Inner {}

declare namespace Outer {
	interface Inner {}
}
