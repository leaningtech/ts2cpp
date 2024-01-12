/// <reference no-default-lib="true"/>

declare interface Outer {
	getInnest1(): Outer.Inner1.Innest1;
}

declare namespace Outer {
	interface Inner1 {
		getInnest2(): Outer.Inner2.Innest2;
	}

	interface Inner2 extends Outer {}

	namespace Inner1 {
		interface Innest1 {}
	}

	namespace Inner2 {
		interface Innest2 {}
	}
}
