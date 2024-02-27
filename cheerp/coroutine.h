#ifndef CHEERP_ASYNC_H
#define CHEERP_ASYNC_H

#include "cheerp/clientlib.h"

#include <coroutine>
#include <exception>

namespace cheerp [[cheerp::genericjs]] {
	template<class T>
	struct promise_base {
		client::Promise<T>* get_return_object() {
			auto* func = new client::_Function<void(
				client::_Function<void(client::_Union<client::_Any*, client::PromiseLike<client::_Any*>*>*)>*,
				client::_Function<void(client::_Any*)>*
			)>([this](client::Function* resolve) {
				this->resolve = resolve;
			});

			return new client::Promise<T>(*func);
		}

		auto initial_suspend() const noexcept {
			return std::suspend_never();
		}

		auto final_suspend() const noexcept {
			return std::suspend_never();
		}

	protected:
		client::Function* resolve;
	};

	struct promise_awaiter_base {
		bool await_ready() const noexcept {
			return false;
		}

	protected:
		client::Promise<client::_Any*>* promise;
	};

	template<class T>
	struct promise_awaiter : promise_awaiter_base {
		promise_awaiter(client::Promise<T>* promise) {
			this->promise = promise->cast();
		}

		void await_suspend(std::coroutine_handle<> handle) {
			promise->template then<void>([this, handle](client::_Any* value) {
				this->value = value->cast();
				handle.resume();
			});
		}

		T await_resume() const {
			return value;
		}

	private:
		T value;
	};

	template<>
	struct promise_awaiter<void> : promise_awaiter_base {
		promise_awaiter(client::Promise<void>* promise) {
			this->promise = reinterpret_cast<client::Promise<client::_Any*>*>(promise);
		}

		void await_suspend(std::coroutine_handle<> handle) {
			promise->then<void>([this, handle]() {
				handle.resume();
			});
		}

		void await_resume() const {
		}
	};
}

template<class... Args>
struct std::coroutine_traits<client::Promise<void>*, Args...> {
	struct [[cheerp::genericjs]] promise_type : cheerp::promise_base<void> {
		void return_void() {
			resolve->call(nullptr);
		}
	};
};

template<class T, class... Args>
struct std::coroutine_traits<client::Promise<T>*, Args...> {
	struct [[cheerp::genericjs]] promise_type : cheerp::promise_base<T> {
		void return_value(T value) {
			cheerp::promise_base<T>::resolve->call(nullptr, value);
		}
	};
};

template<class T>
[[cheerp::genericjs]]
cheerp::promise_awaiter<T> operator co_await(client::Promise<T>& promise) {
	return &promise;
}

#endif
