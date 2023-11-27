#ifndef CHEERP_FUNCTION_H
#define CHEERP_FUNCTION_H
#include "cheerp/types.h"
namespace [[cheerp::genericjs]] client {
	class EventListener;
	template<class F>
	// TODO: make Object virtual
	class _Function : public Function, public Object {
	public:
		_Function(const EventListener* x) : Object(reinterpret_cast<const _Any*>(x)) {
		}
	};
}
#endif
