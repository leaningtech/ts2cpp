/// <reference no-default-lib="true"/>

declare interface Outer {}

declare namespace Outer {
	interface Inner extends Outer {}
}
